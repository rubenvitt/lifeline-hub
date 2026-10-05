//! Benutzername bei Anmeldung und Anlage (LFH-921, LFH-981, Spec `passwort-anmeldung`).
//!
//! Eigenes Test-Binary: der Passkey-Start braucht den prozessweiten Webauthn-`OnceLock`, und die
//! Sperr-Tests zählen in der prozessweiten Fehlversuchstabelle. Jeder Test nimmt deshalb eine
//! eigene Quelladresse.

use axum::body::{to_bytes, Body};
use axum::extract::ConnectInfo;
use axum::http::{header, Request, StatusCode};
use serde_json::{json, Value};
use std::net::SocketAddr;
use tower::ServiceExt;

mod common;
use common::{anfrage, login_cookie, setup_mit_pool};

/// POST `/api/auth/login` von `quelle` mit beliebigem Namen; liefert (Status, JSON).
async fn login(
    app: &axum::Router,
    quelle: &str,
    benutzername: &str,
    passwort: &str,
) -> (StatusCode, Value) {
    let mut req = Request::builder()
        .method("POST")
        .uri("/api/auth/login")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "benutzername": benutzername, "passwort": passwort }).to_string(),
        ))
        .unwrap();
    let peer: SocketAddr = quelle.parse().unwrap();
    req.extensions_mut().insert(ConnectInfo(peer));
    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

async fn audit_zeilen(pool: &sqlx::SqlitePool) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM auth_audit")
        .fetch_one(pool)
        .await
        .unwrap()
}

/// Spec: „Großgeschriebener Anfangsbuchstabe“ und „Angehängtes Leerzeichen beim Login“.
#[tokio::test]
async fn login_ignoriert_schreibweise_und_randleerzeichen() {
    let (app, _pool) = setup_mit_pool().await;
    for (i, name) in ["Admin", "ADMIN", " admin ", "admin\t"].iter().enumerate() {
        let (status, json) =
            login(&app, &format!("192.0.2.{}:4000", 10 + i), name, "startpw12").await;
        assert_eq!(
            status,
            StatusCode::OK,
            "`{name}` muss sich anmelden: {json}"
        );
        assert_eq!(
            json["benutzername"], "admin",
            "gespeicherte Schreibweise bleibt"
        );
    }
}

/// Spec: „Login mit überlangem Namen“. Zehn überlange Versuche sperren die Quelle nicht: der
/// richtige Login danach geht durch.
#[tokio::test]
async fn ueberlanger_name_ist_400_ohne_audit_und_ohne_fehlversuch() {
    let (app, pool) = setup_mit_pool().await;
    let quelle = "192.0.2.30:4000";
    let zu_lang = "a".repeat(129);
    let vorher = audit_zeilen(&pool).await;

    for i in 0..10 {
        let (status, json) = login(&app, quelle, &zu_lang, "falsch").await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "Versuch {i}: {json}");
        assert!(json["error"].as_str().unwrap().contains("128"), "{json}");
    }
    assert_eq!(audit_zeilen(&pool).await, vorher, "kein Audit für 400");

    let (status, _) = login(&app, quelle, "admin", "startpw12").await;
    assert_eq!(
        status,
        StatusCode::OK,
        "überlange Namen zählen nicht als Fehlversuch"
    );
}

/// Gegenprobe zu oben: ein langer, aber zulässiger Name ist ein gewöhnlicher Fehlversuch und
/// steht gekürzt im Audit.
#[tokio::test]
async fn langer_unbekannter_name_steht_gekuerzt_im_audit() {
    let (app, pool) = setup_mit_pool().await;
    let name = "b".repeat(100);

    let (status, _) = login(&app, "192.0.2.31:4000", &name, "falsch").await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    let gespeichert: String = sqlx::query_scalar(
        "SELECT benutzername FROM auth_audit WHERE ereignis = 'login_fehlgeschlagen'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(gespeichert, format!("{}…", "b".repeat(64)));
}

/// Spec: „Falsches Passwort sperrt weiter“.
#[tokio::test]
async fn falsche_passwoerter_sperren_weiterhin_nach_zehn_versuchen() {
    let (app, _pool) = setup_mit_pool().await;
    let quelle = "192.0.2.32:4000";
    for i in 0..10 {
        let (status, _) = login(&app, quelle, "Admin", "falsch").await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "Versuch {i}");
    }
    let (status, _) = login(&app, quelle, "admin", "startpw12").await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
}

async fn anlegen(app: &axum::Router, cookie: &str, benutzername: &str) -> (StatusCode, Value) {
    let body = json!({
        "anzeigename": "Neu",
        "benutzername": benutzername,
        "passwort": "geheim1234",
    })
    .to_string();
    anfrage(app, "POST", "/api/benutzer", cookie, Some(&body)).await
}

/// Spec: „Zweiter Name in anderer Schreibweise“, „Anlage mit Leerzeichen“, „Anlage mit
/// überlangem Namen“.
#[tokio::test]
async fn anlage_trimmt_begrenzt_und_ist_ohne_schreibweise_eindeutig() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;

    let (status, json) = anlegen(&app, &admin, "Admin").await;
    assert_eq!(status, StatusCode::CONFLICT, "{json}");
    assert_eq!(json["error"], "Benutzername ist bereits vergeben");

    let (status, json) = anlegen(&app, &admin, "  max ").await;
    assert_eq!(status, StatusCode::CREATED, "{json}");
    assert_eq!(json["benutzername"], "max");

    let (status, _) = anlegen(&app, &admin, "MAX").await;
    assert_eq!(status, StatusCode::CONFLICT);

    let (status, _) = anlegen(&app, &admin, &"c".repeat(129)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    let (status, _) = anlegen(&app, &admin, &"c".repeat(128)).await;
    assert_eq!(status, StatusCode::CREATED);
}

/// Spec: „Vertippt in anderer Schreibweise, dann angemeldet“: der Erfolg als `max` räumt die
/// Fehlversuche als `Max`, sonst stünde die Quelle nach acht weiteren vor der Sperre.
#[tokio::test]
async fn erfolg_raeumt_fehlversuche_in_anderer_schreibweise() {
    let (app, _pool) = setup_mit_pool().await;
    let quelle = "192.0.2.34:4000";
    for _ in 0..2 {
        let (status, _) = login(&app, quelle, "Admin", "falsch").await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }
    let (status, _) = login(&app, quelle, "admin", "startpw12").await;
    assert_eq!(status, StatusCode::OK);

    for i in 0..9 {
        let (status, _) = login(&app, quelle, "ADMIN", "falsch").await;
        assert_eq!(
            status,
            StatusCode::UNAUTHORIZED,
            "Versuch {i}: noch nicht gesperrt"
        );
    }
}

/// Ein Passwort, das der Login (4 KiB Body) nicht mehr annähme, lässt sich nicht setzen.
#[tokio::test]
async fn anlage_begrenzt_das_passwort_auf_128_zeichen() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let anlage = |name: &str, pw: String| {
        json!({ "anzeigename": "Neu", "benutzername": name, "passwort": pw }).to_string()
    };

    let (status, json) = anfrage(
        &app,
        "POST",
        "/api/benutzer",
        &admin,
        Some(&anlage("lang", "ü".repeat(129))),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{json}");

    let grenze = "\u{1F512}".repeat(128);
    let (status, json) = anfrage(
        &app,
        "POST",
        "/api/benutzer",
        &admin,
        Some(&anlage("grenze", grenze.clone())),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{json}");
    let (status, json) = login(&app, "192.0.2.35:4000", "grenze", &grenze).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "das längste zulässige Passwort passt in den Login: {json}"
    );
}

/// Spec: „Deaktiviertes Konto in anderer Schreibweise“.
#[tokio::test]
async fn deaktiviertes_konto_bleibt_in_anderer_schreibweise_gesperrt() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (status, _) = anlegen(&app, &admin, "max").await;
    assert_eq!(status, StatusCode::CREATED);
    sqlx::query("UPDATE benutzer SET aktiv = 0 WHERE benutzername = 'max'")
        .execute(&pool)
        .await
        .unwrap();

    let (status, json) = login(&app, "192.0.2.33:4000", "Max", "geheim1234").await;
    assert_eq!(status, StatusCode::UNAUTHORIZED, "{json}");
}

fn webauthn_aktivieren() {
    lifeline_hub::auth::provider::registry::set_webauthn_konfiguriert(true);
    lifeline_hub::auth::webauthn::set_webauthn(
        lifeline_hub::auth::webauthn::baue("localhost", "https://localhost").unwrap(),
    );
}

/// Ein synthetischer, kryptografisch bedeutungsloser Passkey (wie in `auth::webauthn::storage`).
fn test_passkey() -> webauthn_rs::prelude::Passkey {
    use webauthn_rs::prelude::Credential;
    use webauthn_rs_core::proto::{
        AttestationFormat, COSEAlgorithm, COSEEC2Key, COSEKey, COSEKeyType, ECDSACurve,
        ParsedAttestation, RegisteredExtensions, UserVerificationPolicy,
    };
    webauthn_rs::prelude::Passkey::from(Credential {
        cred_id: b"cred-schreibweise".to_vec().into(),
        cred: COSEKey {
            type_: COSEAlgorithm::ES256,
            key: COSEKeyType::EC_EC2(COSEEC2Key {
                curve: ECDSACurve::SECP256R1,
                x: vec![7u8; 32].into(),
                y: vec![9u8; 32].into(),
            }),
        },
        counter: 0,
        transports: None,
        user_verified: true,
        backup_eligible: false,
        backup_state: false,
        registration_policy: UserVerificationPolicy::Required,
        extensions: RegisteredExtensions::none(),
        attestation: ParsedAttestation::default(),
        attestation_format: AttestationFormat::None,
    })
}

/// Spec: „Passkey-Start mit abweichender Schreibweise“, dazu die Höchstlänge.
#[tokio::test]
async fn passkey_start_findet_den_namen_ohne_schreibweise() {
    webauthn_aktivieren();
    let (app, pool) = setup_mit_pool().await;
    let admin_id: i64 = sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername = 'admin'")
        .fetch_one(&pool)
        .await
        .unwrap();
    lifeline_hub::auth::webauthn::storage::speichere_passkey(&pool, admin_id, &test_passkey())
        .await
        .unwrap();

    let (status, json) = anfrage(
        &app,
        "POST",
        "/api/auth/webauthn/auth/start",
        "",
        Some(r#"{"benutzername":" ADMIN "}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json}");
    assert!(json["publicKey"]["challenge"].is_string(), "{json}");

    let body = json!({ "benutzername": "d".repeat(129) }).to_string();
    let (status, _) = anfrage(
        &app,
        "POST",
        "/api/auth/webauthn/auth/start",
        "",
        Some(&body),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}
