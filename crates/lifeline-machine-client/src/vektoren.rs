//! Testvektoren (`docs/api/machine-auth-testvektoren.json`): feste Schlüssel, feste Zeit, feste
//! `jti`. Ed25519 ist deterministisch, also ist jedes JWS bytegleich. Dieser Test rechnet alles
//! neu und vergleicht; `LIFELINE_TESTVEKTOREN_SCHREIBEN=1` schreibt die Datei neu. Server,
//! TypeScript-Modul und Python-Beispiel prüfen gegen dieselbe Datei.

use super::*;
use serde_json::{json, Value};

pub(crate) const CODE: &str = "abcd-efgh-jkmn-pqrs";
pub(crate) const ZUGANG_ID: &str = "0f8c2a6e-3b1d-4c5a-9e7f-2d4b6a8c0e12";
pub(crate) const INSTANZ_ID: &str = "7d3e9b1a-5c2f-4e8d-a6b4-1f0c3e5a7b9d";
pub(crate) const WEBHOOK_ID: &str = "3c9e1f7a-2b4d-4f6e-8a0c-5d7b9e1f3a2c";

fn seed(start: u8) -> [u8; 32] {
    std::array::from_fn(|i| start.wrapping_add(i as u8))
}

fn datei() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../docs/api/machine-auth-testvektoren.json")
}

fn anfrage(cred: &Credentials, method: &str, path: &str, body: &str, iat: i64, jti: &str) -> Value {
    let auth = cred
        .sign_request(method, path, body.as_bytes(), iat, jti)
        .unwrap();
    let jws = auth.strip_prefix("Machine ").unwrap().to_string();
    let teile: Vec<&str> = jws.split('.').collect();
    json!({
        "method": method,
        "path": path,
        "body": body,
        "iat": iat,
        "jti": jti,
        "header_json": String::from_utf8(parse_b64(teile[0]).unwrap()).unwrap(),
        "claims_json": String::from_utf8(parse_b64(teile[1]).unwrap()).unwrap(),
        "jws": jws,
    })
}

fn berechne() -> Value {
    let client = SigningKey::from_bytes(&seed(0x01));
    let instanz = SigningKey::from_bytes(&seed(0x80));
    let client_pub = client.verifying_key().to_bytes();
    let instanz_pub = instanz.verifying_key().to_bytes();

    let (d, redeem) = prepare_redeem(CODE, &client).unwrap();
    let antwort_proof = hmac_b64(
        &d.k_issuer,
        &transcript_issuer(
            &d.lookup,
            &b64(&client_pub),
            INSTANZ_ID,
            &b64(&instanz_pub),
            ZUGANG_ID,
        ),
    );
    let redeem_response = RedeemResponse {
        zugang_id: ZUGANG_ID.into(),
        instanz_id: INSTANZ_ID.into(),
        instanz_public_key: Jwk::ed25519(&instanz_pub),
        proof: antwort_proof,
    };
    let cred = finish_redeem(&d, &client, "https://hub.example", &redeem_response).unwrap();

    let me = anfrage(
        &cred,
        "GET",
        "/api/v1/me",
        "",
        1_794_423_731,
        "AAECAwQFBgcICQoLDA0ODw",
    );
    let post_body = r#"{"external_id":"LS-2026-118833","kind":"neu","stichwort":"RD 2"}"#;
    let post = anfrage(
        &cred,
        "POST",
        "/api/v1/alarmmeldungen?dry_run=1",
        post_body,
        1_794_423_740,
        "EBESExQVFhcYGRobHB0eHw",
    );

    let antwort_body = r#"{"id":"a1","state":"offen"}"#;
    let antwort_claims = ResponseClaims {
        iss: INSTANZ_ID.into(),
        aud: ZUGANG_ID.into(),
        iat: 1_794_423_741,
        exp: 1_794_423_741 + LIFETIME_S,
        jti: "ICEiIyQlJicoKSorLC0uLw".into(),
        req: "EBESExQVFhcYGRobHB0eHw".into(),
        status: 201,
        bh: sha256_b64(antwort_body.as_bytes()),
    };
    let antwort_jws = sign_compact(&instanz, TYP_RESPONSE, INSTANZ_ID, &antwort_claims);
    assert!(cred
        .verify_response(
            &antwort_jws,
            "EBESExQVFhcYGRobHB0eHw",
            201,
            antwort_body.as_bytes(),
            1_794_423_741
        )
        .is_ok());

    let webhooks = webhook_vektoren(&client, &instanz, &instanz_pub);

    json!({
        "beschreibung": "Testvektoren für den Maschinenzugang (ADR-0022, docs/api/maschinenzugang.md). Schlüssel als Base64url ohne Auffüllung; JSON von Kopf und Claims ohne Leerzeichen, Felder in genau dieser Reihenfolge. Erzeugt von crates/lifeline-machine-client (cargo test), geprüft von Server, TypeScript-Modul und Python-Beispiel.",
        "code": CODE,
        "code_normalized": normalize_code(CODE).unwrap(),
        "salt": String::from_utf8(SALT.to_vec()).unwrap(),
        "client_private_key": b64(&client.to_bytes()),
        "client_public_key": b64(&client_pub),
        "client_fingerprint": fingerprint(&client_pub),
        "instanz_id": INSTANZ_ID,
        "instanz_private_key": b64(&instanz.to_bytes()),
        "instanz_public_key": b64(&instanz_pub),
        "zugang_id": ZUGANG_ID,
        "redeem_request": serde_json::to_value(&redeem).unwrap(),
        "redeem_response": serde_json::to_value(&redeem_response).unwrap(),
        "requests": [me, post],
        "response": {
            "status": 201,
            "body": antwort_body,
            "iat": antwort_claims.iat,
            "jti": antwort_claims.jti,
            "req": antwort_claims.req,
            "claims_json": serde_json::to_string(&antwort_claims).unwrap(),
            "jws": antwort_jws,
        },
        "webhooks": webhooks,
    })
}

/// Webhook-Zustellung (LLH-1656): ein gültiger Fall und je ungültigem Fall der erwartete Fehler
/// (`Signatur`, `Body`, `Ziel`, `Zeit`, `Typ`). Jeder Client prüft `jws` gegen `body`,
/// `webhook_id` und `now` und muss genau diesen Fehler melden.
fn webhook_vektoren(client: &SigningKey, instanz: &SigningKey, instanz_pub: &[u8; 32]) -> Value {
    let body = r#"{"id":4712,"type":"einsatz.created","occurred_at":"2026-11-11 19:04:00","einsatz_id":7}"#;
    let iat = 1_794_423_800;
    let claims = WebhookClaims {
        iss: INSTANZ_ID.into(),
        aud: WEBHOOK_ID.into(),
        iat,
        exp: iat + EVENT_LIFETIME_S,
        jti: "MDEyMzQ1Njc4OTo7PD0-Pw".into(),
        bh: sha256_b64(body.as_bytes()),
    };
    let jws = sign_compact(instanz, TYP_EVENT, INSTANZ_ID, &claims);
    let fremd = sign_compact(client, TYP_EVENT, INSTANZ_ID, &claims);
    let falscher_typ = sign_compact(instanz, TYP_RESPONSE, INSTANZ_ID, &claims);
    let geaendert = body.replace("4712", "4713");
    let fall =
        |name: &str, jws: &str, body: &str, webhook_id: &str, now: i64, fehler: Option<&str>| {
            json!({
                "name": name,
                "jws": jws,
                "body": body,
                "webhook_id": webhook_id,
                "now": now,
                "fehler": fehler,
            })
        };
    let faelle = vec![
        fall("gueltig", &jws, body, WEBHOOK_ID, iat, None),
        fall(
            "fremder_schluessel",
            &fremd,
            body,
            WEBHOOK_ID,
            iat,
            Some("Signatur"),
        ),
        fall(
            "geaenderter_body",
            &jws,
            &geaendert,
            WEBHOOK_ID,
            iat,
            Some("Body"),
        ),
        fall(
            "falsche_aud",
            &jws,
            body,
            "anderer-webhook",
            iat,
            Some("Ziel"),
        ),
        fall(
            "abgelaufen",
            &jws,
            body,
            WEBHOOK_ID,
            iat + EVENT_LIFETIME_S + CLOCK_TOLERANCE_S + 1,
            Some("Zeit"),
        ),
        fall(
            "falscher_typ",
            &falscher_typ,
            body,
            WEBHOOK_ID,
            iat,
            Some("Typ"),
        ),
    ];
    // Der Client selbst muss jeden Fall so sehen.
    for f in &faelle {
        let ergebnis = verify_webhook(
            f["jws"].as_str().unwrap(),
            &b64(instanz_pub),
            INSTANZ_ID,
            f["webhook_id"].as_str().unwrap(),
            f["body"].as_str().unwrap().as_bytes(),
            f["now"].as_i64().unwrap(),
        );
        match f["fehler"].as_str() {
            None => assert!(ergebnis.is_ok(), "{f}: {ergebnis:?}"),
            Some(w) => assert_eq!(
                ergebnis.unwrap_err(),
                Error::InvalidWebhook(match w {
                    "Signatur" => "Signatur",
                    "Body" => "Body",
                    "Ziel" => "Ziel",
                    "Zeit" => "Zeit",
                    _ => "Typ",
                }),
                "{f}"
            ),
        }
    }
    let teile: Vec<&str> = jws.split('.').collect();
    json!({
        "header": RESPONSE_HEADER,
        "webhook_id": WEBHOOK_ID,
        "body": body,
        "iat": iat,
        "jti": claims.jti,
        "header_json": String::from_utf8(parse_b64(teile[0]).unwrap()).unwrap(),
        "claims_json": String::from_utf8(parse_b64(teile[1]).unwrap()).unwrap(),
        "jws": jws,
        "faelle": faelle,
    })
}

#[test]
fn testvektoren_sind_aktuell() {
    let neu = serde_json::to_string_pretty(&berechne()).unwrap() + "\n";
    if std::env::var_os("LIFELINE_TESTVEKTOREN_SCHREIBEN").is_some() {
        std::fs::write(datei(), &neu).unwrap();
        return;
    }
    let alt = std::fs::read_to_string(datei()).unwrap_or_default();
    assert!(
        alt == neu,
        "docs/api/machine-auth-testvektoren.json ist veraltet; neu schreiben mit \
         LIFELINE_TESTVEKTOREN_SCHREIBEN=1 cargo test -p lifeline-machine-client"
    );
}

#[test]
fn fremder_proof_beim_einloesen_scheitert() {
    let client = SigningKey::from_bytes(&seed(0x01));
    let (d, _) = prepare_redeem(CODE, &client).unwrap();
    let falsch = RedeemResponse {
        zugang_id: ZUGANG_ID.into(),
        instanz_id: INSTANZ_ID.into(),
        instanz_public_key: Jwk::ed25519(&[9u8; 32]),
        proof: b64(&[0u8; 32]),
    };
    assert_eq!(
        finish_redeem(&d, &client, "https://x", &falsch).unwrap_err(),
        Error::InvalidProof
    );
}

#[test]
fn code_in_jeder_schreibweise() {
    assert_eq!(
        normalize_code("abcd efgh-jkmn-pqrs").unwrap(),
        "ABCDEFGHJKMNPQRS"
    );
    assert_eq!(normalize_code("ABCDEFGHJKMNPQRU"), Err(Error::InvalidCode));
    assert_eq!(normalize_code("ABCD"), Err(Error::InvalidCode));
}

#[test]
fn antwort_an_einen_anderen_zugang_scheitert() {
    let v = berechne();
    let mut cred = Credentials {
        zugang_id: "anderer".into(),
        instanz_id: INSTANZ_ID.into(),
        base_url: "https://hub.example".into(),
        private_key: b64(&seed(0x01)),
        public_key: String::new(),
        instanz_public_key: v["instanz_public_key"].as_str().unwrap().into(),
    };
    let jws = v["response"]["jws"].as_str().unwrap();
    let body = v["response"]["body"].as_str().unwrap().as_bytes();
    assert_eq!(
        cred.verify_response(jws, "EBESExQVFhcYGRobHB0eHw", 201, body, 1_794_423_741),
        Err(Error::InvalidResponse("Ziel"))
    );
    cred.zugang_id = ZUGANG_ID.into();
    assert_eq!(
        cred.verify_response(jws, "andere-jti", 201, body, 1_794_423_741),
        Err(Error::InvalidResponse("Bezug"))
    );
    assert_eq!(
        cred.verify_response(
            jws,
            "EBESExQVFhcYGRobHB0eHw",
            201,
            body,
            1_794_423_741 + 400
        ),
        Err(Error::InvalidResponse("Zeit"))
    );
}
