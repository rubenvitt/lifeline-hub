//! Signierte Nachrichten zwischen gekoppelten Instanzen (design.md D3): kompaktes JWS mit EdDSA,
//! Muster DPoP/`private_key_jwt`. Vorgabe für LLH-1148 in ADR-0034 (vormals ADR-0014).
//!
//! Selbst geschrieben, weil das Format fest ist: es gibt genau einen Algorithmus (`EdDSA`), und
//! jeder andere Kopf wird abgelehnt, bevor eine Signatur geprüft wird. Ein JWT-Crate müsste
//! Algorithmus-Verwirrung erst wieder ausschließen.

use super::basis32::{b64, parse_b64, sha256_b64};
use super::identitaet::Identitaet;
use ed25519_dalek::{Signature, VerifyingKey};
use serde::{de::DeserializeOwned, Deserialize, Serialize};

/// Was ein Anmeldeprofil nach ADR-0034 festlegt: `typ` von Anfrage und Antwort, das Schema im
/// Kopf `Authorization` und den Kopf der Antwortsignatur. Instanzen und Fremdsysteme
/// (Maschinenzugang, ADR-0022) teilen Signatur und Prüfung und unterscheiden sich nur hierin; ein
/// Token des einen Profils scheitert am anderen schon am `typ`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Profil {
    pub typ_anfrage: &'static str,
    pub typ_antwort: &'static str,
    pub schema: &'static str,
    pub antwort_kopf: &'static str,
}

/// Gekoppelte Instanzen (Kopplungsprotokoll mit `pv`).
pub const INSTANZ: Profil = Profil {
    typ_anfrage: "lifeline-instanz+jwt",
    typ_antwort: "lifeline-instanz-antwort+jwt",
    schema: "Instanz",
    antwort_kopf: "lifeline-instanz-antwort",
};

/// Fremdsysteme an der öffentlichen API (`/api/v1/`, ADR-0022). Wire-Namen sind Technik und
/// deshalb englisch (Konzept D9).
pub const MACHINE: Profil = Profil {
    typ_anfrage: "lifeline-machine+jwt",
    typ_antwort: "lifeline-machine-response+jwt",
    schema: "Machine",
    antwort_kopf: "Lifeline-Signature",
};

/// `typ` der Zustellung eines Webhooks an ein Fremdsystem (LLH-1656, Spec `webhook-zustellung`).
/// Ein eigener Typ, damit weder eine Antwort als Zustellung noch eine Zustellung als Antwort
/// durchgeht (design.md D4).
pub const EVENT_TYP: &str = "lifeline-event+jwt";
/// Kopf, der die Signatur einer Webhook-Zustellung trägt; derselbe wie bei Antworten an
/// Fremdsysteme.
pub const EVENT_KOPF: &str = MACHINE.antwort_kopf;
/// Höchste Lebensdauer der Signatur einer Webhook-Zustellung (Konzept D4: höchstens 5 min).
pub const EVENT_LEBENSDAUER_S: i64 = 300;

/// `typ` einer Anfrage.
pub const TYP_ANFRAGE: &str = INSTANZ.typ_anfrage;
/// `typ` einer Antwort.
pub const TYP_ANTWORT: &str = INSTANZ.typ_antwort;
/// Kopf, der eine Anfrage trägt: `Authorization: Instanz <jws>`.
pub const SCHEMA: &str = INSTANZ.schema;
/// Kopf, der eine Antwort trägt.
pub const ANTWORT_KOPF: &str = INSTANZ.antwort_kopf;
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

/// Claims einer Anfrage eines Fremdsystems: wie [`Anfrage`], ohne `pv` (die Version steckt im
/// Pfad `/api/v1/`). `iss` ist die Zugangs-ID, `aud` die Instanz-UUID. Die Reihenfolge der Felder
/// ist die der Testvektoren (`docs/api/machine-auth-testvektoren.json`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MachineAnfrage {
    pub iss: String,
    pub aud: String,
    pub iat: i64,
    pub exp: i64,
    pub jti: String,
    pub htm: String,
    pub htu: String,
    pub bh: String,
}

/// Claims der Antwort an ein Fremdsystem. `req` ist die `jti` der Anfrage.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MachineAntwort {
    pub iss: String,
    pub aud: String,
    pub iat: i64,
    pub exp: i64,
    pub jti: String,
    pub req: String,
    pub status: u16,
    pub bh: String,
}

/// Claims der Zustellung eines Webhooks (LLH-1656). `aud` ist die Kennung des Webhooks: Ein
/// Empfänger kann eine Zustellung nicht an einen anderen weiterreichen, der sie als echt annähme.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WebhookClaims {
    pub iss: String,
    pub aud: String,
    pub iat: i64,
    pub exp: i64,
    pub jti: String,
    pub bh: String,
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

pub(crate) fn sign<C: Serialize>(identitaet: &Identitaet, typ: &str, claims: &C) -> String {
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
pub(crate) fn verify<C: DeserializeOwned>(
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

/// Rechnet ohne Überlauf: die Zeitstempel kommen signiert, aber von der Gegenstelle.
fn is_zeit_valid(iat: i64, exp: i64, jetzt: i64) -> bool {
    exp > iat
        && exp
            .checked_sub(iat)
            .is_some_and(|dauer| dauer <= LEBENSDAUER_S)
        && iat <= jetzt.saturating_add(UHR_TOLERANZ_S)
        && exp >= jetzt.saturating_sub(UHR_TOLERANZ_S)
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
    check_bindung(
        &Bindung {
            iss: &c.iss,
            aud: &c.aud,
            iat: c.iat,
            exp: c.exp,
            htm: &c.htm,
            htu: &c.htu,
            bh: &c.bh,
        },
        &Erwartung {
            absender: absender_kennung,
            eigene: eigene_kennung,
            methode,
            pfad,
            body,
            jetzt,
        },
    )?;
    Ok(c)
}

/// Die Teile einer Anfrage, die an Absender, Ziel, Methode, Pfad, Body und Zeit binden.
struct Bindung<'a> {
    iss: &'a str,
    aud: &'a str,
    iat: i64,
    exp: i64,
    htm: &'a str,
    htu: &'a str,
    bh: &'a str,
}

/// Was beim Empfänger ankam.
struct Erwartung<'a> {
    absender: &'a str,
    eigene: &'a str,
    methode: &'a str,
    pfad: &'a str,
    body: &'a [u8],
    jetzt: i64,
}

/// Gemeinsamer Abgleich beider Profile, in fester Reihenfolge: Ziel, Methode, Pfad, Body, Zeit.
fn check_bindung(b: &Bindung<'_>, e: &Erwartung<'_>) -> Result<(), SignaturError> {
    if b.iss != e.absender || b.aud != e.eigene {
        return Err(SignaturError::Ziel);
    }
    if !b.htm.eq_ignore_ascii_case(e.methode) {
        return Err(SignaturError::Methode);
    }
    if b.htu != e.pfad {
        return Err(SignaturError::Pfad);
    }
    if b.bh != sha256_b64(e.body) {
        return Err(SignaturError::Body);
    }
    if !is_zeit_valid(b.iat, b.exp, e.jetzt) {
        return Err(SignaturError::Zeit);
    }
    Ok(())
}

/// Ablehnung einer Anfrage eines Fremdsystems: der Fehler und, sobald die Signatur gilt, die
/// Abweichung `iat - jetzt` in Sekunden. Nach außen ist jeder Fall 401; Grund und Abweichung
/// stehen nur am Zugang (Seite „Anbindungen“), damit der Admin eine falsch gehende Uhr erkennt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MachineAblehnung {
    pub fehler: SignaturError,
    pub abweichung_s: Option<i64>,
}

/// Prüft die Anfrage eines Fremdsystems (Profil [`MACHINE`]). `zugang_id` ist die Kennung des
/// Zugangs aus dem `kid`, `eigene_kennung` die Instanz-UUID. Den Wiederholschutz (`jti`) trägt der
/// Aufrufer.
#[allow(clippy::too_many_arguments)]
pub fn verify_machine_anfrage(
    token: &str,
    schluessel: &VerifyingKey,
    zugang_id: &str,
    eigene_kennung: &str,
    methode: &str,
    pfad: &str,
    body: &[u8],
    jetzt: i64,
) -> Result<MachineAnfrage, MachineAblehnung> {
    let c: MachineAnfrage =
        verify(token, MACHINE.typ_anfrage, schluessel).map_err(|fehler| MachineAblehnung {
            fehler,
            abweichung_s: None,
        })?;
    check_bindung(
        &Bindung {
            iss: &c.iss,
            aud: &c.aud,
            iat: c.iat,
            exp: c.exp,
            htm: &c.htm,
            htu: &c.htu,
            bh: &c.bh,
        },
        &Erwartung {
            absender: zugang_id,
            eigene: eigene_kennung,
            methode,
            pfad,
            body,
            jetzt,
        },
    )
    .map_err(|fehler| MachineAblehnung {
        fehler,
        abweichung_s: Some(c.iat.saturating_sub(jetzt)),
    })?;
    Ok(c)
}

/// Signiert die Antwort an ein Fremdsystem (Profil [`MACHINE`]); `req` ist die `jti` seiner
/// Anfrage.
pub fn sign_machine_antwort(
    identitaet: &Identitaet,
    zugang_id: &str,
    req: &str,
    status: u16,
    body: &[u8],
    jetzt: i64,
) -> String {
    let claims = MachineAntwort {
        iss: identitaet.kennung.clone(),
        aud: zugang_id.to_string(),
        iat: jetzt,
        exp: jetzt + LEBENSDAUER_S,
        jti: new_jti(),
        req: req.to_string(),
        status,
        bh: sha256_b64(body),
    };
    sign(identitaet, MACHINE.typ_antwort, &claims)
}

/// Signiert die Zustellung eines Webhooks (Profil [`EVENT_TYP`], design.md D4). `jti` gibt der
/// Aufrufer vor, je Versuch neu ([`new_jti`]); die Testvektoren setzen ihn fest.
pub fn sign_webhook(
    identitaet: &Identitaet,
    webhook_id: &str,
    body: &[u8],
    jetzt: i64,
    jti: &str,
) -> String {
    let claims = WebhookClaims {
        iss: identitaet.kennung.clone(),
        aud: webhook_id.to_string(),
        iat: jetzt,
        exp: jetzt + EVENT_LEBENSDAUER_S,
        jti: jti.to_string(),
        bh: sha256_b64(body),
    };
    sign(identitaet, EVENT_TYP, &claims)
}

/// Prüft eine Webhook-Zustellung, wie ein Empfänger es tut: Signatur der Instanz, an diesen
/// Webhook, über genau diesen Body, im Zeitfenster. Der Server braucht sie für Tests und die
/// Testvektoren; die Referenz-Clients tragen dieselbe Prüfung.
pub fn verify_webhook(
    token: &str,
    instanz_schluessel: &VerifyingKey,
    webhook_id: &str,
    body: &[u8],
    jetzt: i64,
) -> Result<WebhookClaims, SignaturError> {
    let c: WebhookClaims = verify(token, EVENT_TYP, instanz_schluessel)?;
    if c.aud != webhook_id {
        return Err(SignaturError::Ziel);
    }
    if c.bh != sha256_b64(body) {
        return Err(SignaturError::Body);
    }
    let dauer_ok = c
        .exp
        .checked_sub(c.iat)
        .is_some_and(|dauer| dauer > 0 && dauer <= EVENT_LEBENSDAUER_S);
    if !dauer_ok
        || c.iat > jetzt.saturating_add(UHR_TOLERANZ_S)
        || c.exp < jetzt.saturating_sub(UHR_TOLERANZ_S)
    {
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

    // ---- Webhook-Zustellung (LLH-1656, Spec `webhook-zustellung`) ----

    const WEBHOOK: &str = "0b7f6c2e-9a1d-4e3b-8c5f-2a4d6e8f0a1c";
    const EREIGNIS: &[u8] =
        br#"{"id":4712,"type":"einsatz.created","occurred_at":"2026-11-11 19:04:00","einsatz_id":7}"#;

    #[test]
    fn webhook_hin_und_zurueck_ist_gueltig() {
        let t = sign_webhook(&elw(), WEBHOOK, EREIGNIS, JETZT, "jti-1");
        let c = verify_webhook(&t, &pk(&elw()), WEBHOOK, EREIGNIS, JETZT).unwrap();
        assert_eq!(c.iss, "elw");
        assert_eq!(c.aud, WEBHOOK);
        assert_eq!(c.jti, "jti-1");
        assert_eq!(c.exp - c.iat, EVENT_LEBENSDAUER_S);
        assert_eq!(parse_kopf(&t, EVENT_TYP).unwrap().kid, "elw");
        // Auch nach Ablauf der Lebensdauer gilt sie noch innerhalb der Uhrentoleranz.
        assert!(verify_webhook(&t, &pk(&elw()), WEBHOOK, EREIGNIS, JETZT + 300 + 299).is_ok());
    }

    #[test]
    fn webhook_fremder_schluessel_body_aud_und_zeit_scheitern() {
        let t = sign_webhook(&elw(), WEBHOOK, EREIGNIS, JETZT, "jti-1");
        assert_eq!(
            verify_webhook(&t, &pk(&hub()), WEBHOOK, EREIGNIS, JETZT),
            Err(SignaturError::Signatur)
        );
        let mut geaendert = EREIGNIS.to_vec();
        geaendert[7] = b'3';
        assert_eq!(
            verify_webhook(&t, &pk(&elw()), WEBHOOK, &geaendert, JETZT),
            Err(SignaturError::Body)
        );
        assert_eq!(
            verify_webhook(&t, &pk(&elw()), "anderer-webhook", EREIGNIS, JETZT),
            Err(SignaturError::Ziel)
        );
        assert_eq!(
            verify_webhook(&t, &pk(&elw()), WEBHOOK, EREIGNIS, JETZT + 300 + 301),
            Err(SignaturError::Zeit)
        );
        assert_eq!(
            verify_webhook(&t, &pk(&elw()), WEBHOOK, EREIGNIS, JETZT - 301),
            Err(SignaturError::Zeit)
        );
    }

    #[test]
    fn webhook_mit_zu_langer_lebensdauer_scheitert() {
        let claims = WebhookClaims {
            iss: "elw".into(),
            aud: WEBHOOK.into(),
            iat: JETZT,
            exp: JETZT + EVENT_LEBENSDAUER_S + 1,
            jti: "j".into(),
            bh: sha256_b64(EREIGNIS),
        };
        let t = sign(&elw(), EVENT_TYP, &claims);
        assert_eq!(
            verify_webhook(&t, &pk(&elw()), WEBHOOK, EREIGNIS, JETZT),
            Err(SignaturError::Zeit)
        );
    }

    #[test]
    fn webhook_und_antwort_sind_nicht_verwechselbar() {
        // Eine Antwort an ein Fremdsystem geht nicht als Zustellung durch, und umgekehrt.
        let antwort = sign_machine_antwort(&elw(), WEBHOOK, "req", 200, EREIGNIS, JETZT);
        assert_eq!(
            verify_webhook(&antwort, &pk(&elw()), WEBHOOK, EREIGNIS, JETZT),
            Err(SignaturError::Algorithmus)
        );
        let zustellung = sign_webhook(&elw(), WEBHOOK, EREIGNIS, JETZT, "j");
        assert_eq!(
            parse_kopf(&zustellung, MACHINE.typ_antwort),
            Err(SignaturError::Algorithmus)
        );
        // `alg: none` kommt nicht einmal bis zur Signatur.
        let kopf = b64(br#"{"alg":"none","typ":"lifeline-event+jwt","kid":"elw"}"#);
        let rest = zustellung.split_once('.').unwrap().1;
        assert_eq!(
            verify_webhook(
                &format!("{kopf}.{rest}"),
                &pk(&elw()),
                WEBHOOK,
                EREIGNIS,
                JETZT
            ),
            Err(SignaturError::Algorithmus)
        );
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
    fn extreme_zeitstempel_laufen_nicht_ueber() {
        // `exp - iat` liefe mit `iat = i64::MIN` über und läge im Release-Build unter der
        // Lebensdauergrenze, im Debug-Build panikte die Prüfung.
        assert!(!is_zeit_valid(i64::MIN, JETZT, JETZT));
        assert!(!is_zeit_valid(i64::MIN, i64::MAX, JETZT));
        assert!(!is_zeit_valid(JETZT, i64::MAX, i64::MAX));
        assert!(
            is_zeit_valid(i64::MIN, i64::MIN + 1, i64::MIN),
            "am Rand des Wertebereichs rechnet die Toleranz gesättigt statt zu paniken"
        );
        assert!(is_zeit_valid(JETZT, JETZT + 60, JETZT));
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
    /// Signiert wie ein Fremdsystem: `kid` und `iss` sind die Zugangs-ID.
    fn machine_token(
        zugang: &Identitaet,
        aud: &str,
        htm: &str,
        htu: &str,
        body: &[u8],
        iat: i64,
    ) -> String {
        let claims = MachineAnfrage {
            iss: zugang.kennung.clone(),
            aud: aud.into(),
            iat,
            exp: iat + LEBENSDAUER_S,
            jti: "j-1".into(),
            htm: htm.into(),
            htu: htu.into(),
            bh: sha256_b64(body),
        };
        sign(zugang, MACHINE.typ_anfrage, &claims)
    }

    fn zugang() -> Identitaet {
        Identitaet::from_parts("zugang-1", [3u8; 32])
    }

    fn pruefe_machine(
        token: &str,
        body: &[u8],
        jetzt: i64,
    ) -> Result<MachineAnfrage, MachineAblehnung> {
        verify_machine_anfrage(
            token,
            &pk(&zugang()),
            "zugang-1",
            "hub",
            "GET",
            "/api/v1/me",
            body,
            jetzt,
        )
    }

    #[test]
    fn machine_anfrage_gilt_ohne_pv() {
        let t = machine_token(&zugang(), "hub", "get", "/api/v1/me", b"", JETZT);
        let c = pruefe_machine(&t, b"", JETZT).unwrap();
        assert_eq!(c.iss, "zugang-1");
        let claims = parse_b64(t.split('.').nth(1).unwrap()).unwrap();
        assert!(!String::from_utf8(claims).unwrap().contains("\"pv\""));
    }

    #[test]
    fn profile_sind_getrennt() {
        let m = machine_token(
            &zugang(),
            "hub",
            "POST",
            "/api/instanz/melden",
            b"{}",
            JETZT,
        );
        assert_eq!(
            verify_anfrage(
                &m,
                &pk(&zugang()),
                "zugang-1",
                "hub",
                "POST",
                "/api/instanz/melden",
                b"{}",
                JETZT
            ),
            Err(SignaturError::Algorithmus),
            "ein Maschinen-Token gilt nicht als Instanz-Anfrage"
        );
        let (i, _) = sign_anfrage(
            &zugang(),
            &AnfrageDraft {
                ziel_kennung: "hub",
                methode: "GET",
                pfad: "/api/v1/me",
                body: b"",
            },
            JETZT,
        );
        assert_eq!(
            pruefe_machine(&i, b"", JETZT).unwrap_err().fehler,
            SignaturError::Algorithmus,
            "eine Instanz-Anfrage gilt nicht als Maschinen-Token"
        );
    }

    #[test]
    fn machine_ablehnung_nennt_die_uhrabweichung() {
        // Uhr des Fremdsystems geht 7 min nach.
        let t = machine_token(&zugang(), "hub", "GET", "/api/v1/me", b"", JETZT - 420);
        let a = pruefe_machine(&t, b"", JETZT).unwrap_err();
        assert_eq!(a.fehler, SignaturError::Zeit);
        assert_eq!(a.abweichung_s, Some(-420));
        // Uhr geht 7 min vor.
        let t = machine_token(&zugang(), "hub", "GET", "/api/v1/me", b"", JETZT + 420);
        assert_eq!(
            pruefe_machine(&t, b"", JETZT).unwrap_err().abweichung_s,
            Some(420)
        );
        // Ohne gültige Signatur keine Abweichung: sie stammte sonst von einem Fremden.
        let fremd = machine_token(&hub(), "hub", "GET", "/api/v1/me", b"", JETZT - 420);
        let a = pruefe_machine(&fremd, b"", JETZT).unwrap_err();
        assert_eq!(
            a,
            MachineAblehnung {
                fehler: SignaturError::Signatur,
                abweichung_s: None
            }
        );
    }

    #[test]
    fn machine_anfrage_bindet_ziel_methode_pfad_body() {
        let t = machine_token(&zugang(), "andere-instanz", "GET", "/api/v1/me", b"", JETZT);
        assert_eq!(
            pruefe_machine(&t, b"", JETZT).unwrap_err().fehler,
            SignaturError::Ziel
        );
        let t = machine_token(&zugang(), "hub", "POST", "/api/v1/me", b"", JETZT);
        assert_eq!(
            pruefe_machine(&t, b"", JETZT).unwrap_err().fehler,
            SignaturError::Methode
        );
        let t = machine_token(&zugang(), "hub", "GET", "/api/v1/me?x=1", b"", JETZT);
        assert_eq!(
            pruefe_machine(&t, b"", JETZT).unwrap_err().fehler,
            SignaturError::Pfad
        );
        let t = machine_token(&zugang(), "hub", "GET", "/api/v1/me", b"", JETZT);
        assert_eq!(
            pruefe_machine(&t, b"x", JETZT).unwrap_err().fehler,
            SignaturError::Body
        );
    }

    #[test]
    fn machine_antwort_ist_an_zugang_und_anfrage_gebunden() {
        let t = sign_machine_antwort(&hub(), "zugang-1", "j-1", 200, b"{}", JETZT);
        let c: MachineAntwort = verify(&t, MACHINE.typ_antwort, &pk(&hub())).unwrap();
        assert_eq!(
            (c.iss.as_str(), c.aud.as_str(), c.req.as_str(), c.status),
            ("hub", "zugang-1", "j-1", 200)
        );
        assert_eq!(c.bh, sha256_b64(b"{}"));
        assert_eq!(
            verify::<MachineAntwort>(&t, MACHINE.typ_anfrage, &pk(&hub())),
            Err(SignaturError::Algorithmus),
            "eine Antwort ist keine Anfrage"
        );
    }
    /// Der Server prüft die Testvektoren des Referenz-Clients (`docs/api/machine-auth-testvektoren.json`,
    /// design.md D9): Code-Ableitung, beide Prüfwerte des Einlösens, jede Anfrage und die
    /// Antwortsignatur. Zwei unabhängige Implementierungen, eine Datei.
    #[test]
    fn testvektoren_des_maschinenzugangs() {
        use crate::instanz::code;
        use serde_json::Value;
        let pfad = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/docs/api/machine-auth-testvektoren.json"
        );
        let v: Value = serde_json::from_str(&std::fs::read_to_string(pfad).unwrap()).unwrap();
        let s = |k: &str| v[k].as_str().unwrap().to_string();

        let d = code::derive_mit_salz(&s("code_normalized"), code::SALZ_MACHINE);
        assert_eq!(d.suche, v["redeem_request"]["lookup"].as_str().unwrap());
        let client_pub = s("client_public_key");
        assert_eq!(
            v["redeem_request"]["public_key"]["x"].as_str().unwrap(),
            client_pub
        );
        assert!(code::is_pruefwert_valid(
            &d.k_einloeser,
            &code::transkript_machine_einloeser(&d.suche, &client_pub),
            v["redeem_request"]["proof"].as_str().unwrap(),
        ));
        let instanz_id = s("instanz_id");
        let zugang_id = s("zugang_id");
        assert_eq!(
            code::pruefwert(
                &d.k_aussteller,
                &code::transkript_machine_aussteller(
                    &d.suche,
                    &client_pub,
                    &instanz_id,
                    &s("instanz_public_key"),
                    &zugang_id,
                ),
            ),
            v["redeem_response"]["proof"].as_str().unwrap()
        );
        assert_eq!(
            crate::instanz::basis32::fingerabdruck(&parse_b64(&client_pub).unwrap()),
            s("client_fingerprint")
        );

        let schluessel = crate::instanz::identitaet::parse_oeffentlich(&client_pub).unwrap();
        for a in v["requests"].as_array().unwrap() {
            let t = |k: &str| a[k].as_str().unwrap();
            let c = verify_machine_anfrage(
                t("jws"),
                &schluessel,
                &zugang_id,
                &instanz_id,
                t("method"),
                t("path"),
                t("body").as_bytes(),
                a["iat"].as_i64().unwrap(),
            )
            .unwrap();
            assert_eq!(serde_json::to_string(&c).unwrap(), t("claims_json"));
        }

        let geheim: [u8; 32] = parse_b64(&s("instanz_private_key"))
            .unwrap()
            .try_into()
            .unwrap();
        let instanz = Identitaet::from_parts(&instanz_id, geheim);
        let r = &v["response"];
        let claims = MachineAntwort {
            iss: instanz_id.clone(),
            aud: zugang_id.clone(),
            iat: r["iat"].as_i64().unwrap(),
            exp: r["iat"].as_i64().unwrap() + LEBENSDAUER_S,
            jti: r["jti"].as_str().unwrap().into(),
            req: r["req"].as_str().unwrap().into(),
            status: r["status"].as_u64().unwrap() as u16,
            bh: sha256_b64(r["body"].as_str().unwrap().as_bytes()),
        };
        assert_eq!(
            sign(&instanz, MACHINE.typ_antwort, &claims),
            r["jws"].as_str().unwrap()
        );

        // Webhook-Zustellung (LLH-1656): der Server signiert byte-gleich, und seine Prüfung sieht
        // jeden Fall wie der Client.
        let w = &v["webhooks"];
        let body = w["body"].as_str().unwrap();
        assert_eq!(
            sign_webhook(
                &instanz,
                w["webhook_id"].as_str().unwrap(),
                body.as_bytes(),
                w["iat"].as_i64().unwrap(),
                w["jti"].as_str().unwrap(),
            ),
            w["jws"].as_str().unwrap()
        );
        assert_eq!(w["header"].as_str().unwrap(), EVENT_KOPF);
        let instanz_pk = pk(&instanz);
        for f in w["faelle"].as_array().unwrap() {
            let ergebnis = verify_webhook(
                f["jws"].as_str().unwrap(),
                &instanz_pk,
                f["webhook_id"].as_str().unwrap(),
                f["body"].as_str().unwrap().as_bytes(),
                f["now"].as_i64().unwrap(),
            );
            let erwartet = match f["fehler"].as_str() {
                None => None,
                Some("Signatur") => Some(SignaturError::Signatur),
                Some("Body") => Some(SignaturError::Body),
                Some("Ziel") => Some(SignaturError::Ziel),
                Some("Zeit") => Some(SignaturError::Zeit),
                Some("Typ") => Some(SignaturError::Algorithmus),
                Some(anders) => panic!("unbekannter Fehler im Vektor: {anders}"),
            };
            assert_eq!(ergebnis.err(), erwartet, "{f}");
        }
    }
}
