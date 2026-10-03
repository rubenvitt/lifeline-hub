//! Auth-Audit-Spur über den echten Router (LFH-249/F30).
//!
//! Die Unit-Tests in `auth::audit` prüfen Schreiben und Purge isoliert. Hier geht es um die
//! Frage, die im Betrieb zählt: hinterlässt ein Anmeldeversuch, der ganz normal über
//! `POST /api/auth/login` hereinkommt, tatsächlich eine Spur — und zwar auch (gerade!) der
//! gescheiterte? Seit LFH-846 auch für OIDC, Passwort mit TOTP und den benutzergebundenen
//! Passkey, dazu ein Guard über jeden Aufruf von `session::anlegen`.

use axum::body::{to_bytes, Body};
use axum::extract::ConnectInfo;
use axum::http::{header, Request, StatusCode};
use axum::response::IntoResponse;
use base64::Engine;
use sha2::Digest;
use std::net::SocketAddr;
use tower::ServiceExt;

mod common;
use common::setup_mit_pool;

async fn login(app: &axum::Router, benutzername: &str, passwort: &str) -> StatusCode {
    let body = format!(r#"{{"benutzername":"{benutzername}","passwort":"{passwort}"}}"#);
    app.clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/login")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap()
        .status()
}

/// Liest die Audit-Spur als (Ereignis, Benutzername)-Paare in Einfügereihenfolge.
async fn spur(pool: &sqlx::SqlitePool) -> Vec<(String, Option<String>)> {
    sqlx::query_as("SELECT ereignis, benutzername FROM auth_audit ORDER BY id")
        .fetch_all(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn fehlgeschlagener_login_hinterlaesst_eine_spur_mit_versuchtem_namen() {
    let (app, pool) = setup_mit_pool().await;

    let status = login(&app, "admin", "falsches-passwort").await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    let eintraege = spur(&pool).await;
    assert_eq!(
        eintraege,
        vec![(
            "login_fehlgeschlagen".to_string(),
            Some("admin".to_string())
        )],
        "ein gescheiterter Anmeldeversuch muss nachweisbar sein — vorher hinterließ er nichts"
    );
}

#[tokio::test]
async fn versuchter_benutzername_wird_auch_protokolliert_wenn_es_ihn_gar_nicht_gibt() {
    let (app, pool) = setup_mit_pool().await;

    // Genau das ist die Brute-Force-Spur: Namen, die niemandem gehören.
    let status = login(&app, "gibtsnicht", "irgendwas").await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    let eintraege = spur(&pool).await;
    assert_eq!(
        eintraege,
        vec![(
            "login_fehlgeschlagen".to_string(),
            Some("gibtsnicht".to_string())
        )]
    );
}

#[tokio::test]
async fn erfolgreicher_login_und_logout_werden_protokolliert() {
    let (app, pool) = setup_mit_pool().await;

    let body = r#"{"benutzername":"admin","passwort":"startpw12"}"#;
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/login")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let cookie = resp
        .headers()
        .get(header::SET_COOKIE)
        .unwrap()
        .to_str()
        .unwrap()
        .to_string();

    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/logout")
                .header(header::COOKIE, cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);

    let ereignisse: Vec<String> = spur(&pool).await.into_iter().map(|(e, _)| e).collect();
    assert_eq!(ereignisse, vec!["login_ok", "logout"]);

    // Beim Logout muss der Benutzer noch zugeordnet sein — er wird VOR dem Löschen der
    // Session bestimmt, danach wäre die Zuordnung weg.
    let benutzer_id: Option<i64> =
        sqlx::query_scalar("SELECT benutzer_id FROM auth_audit WHERE ereignis = 'logout'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(
        benutzer_id.is_some(),
        "der Logout muss dem Benutzer zuzuordnen sein, sonst ist die Spur wertlos"
    );
}

// ===== Jeder Anmeldeweg schreibt sein `login_ok` (LFH-846) =====
//
// Bis LFH-846 schrieben nur Passwort ohne TOTP, der discoverable Passkey und die
// Systembrowser-Einlösung ein `login_ok`. OIDC, Passwort mit TOTP und der benutzergebundene
// Passkey legten eine Sitzung an, ohne Spur: die Anmeldungen von SSO-Konten und TOTP-Nutzern
// fehlten im Audit. Die Tests unten gehen je Weg einmal ganz durch den Router.

/// Eine Zeile der Spur: (Ereignis, Benutzername, Benutzer-Id, Peer-IP, Anbieter).
type Zeile = (String, Option<String>, Option<i64>, Option<String>, String);

async fn zeilen(pool: &sqlx::SqlitePool) -> Vec<Zeile> {
    sqlx::query_as(
        "SELECT ereignis, benutzername, benutzer_id, peer_ip, provider FROM auth_audit ORDER BY id",
    )
    .fetch_all(pool)
    .await
    .unwrap()
}

/// Leert die Spur, damit nur der geprüfte Schritt darin steht (der Vorbereitungs-Login des
/// Admins schreibt selbst ein `login_ok`).
async fn spur_leeren(pool: &sqlx::SqlitePool) {
    sqlx::query("DELETE FROM auth_audit")
        .execute(pool)
        .await
        .unwrap();
}

async fn admin_id(pool: &sqlx::SqlitePool) -> i64 {
    sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername = 'admin'")
        .fetch_one(pool)
        .await
        .unwrap()
}

/// Gibt der Anfrage eine Gegenstelle, wie sie `into_make_service_with_connect_info` im Betrieb
/// setzt; ohne sie liefert `PeerIp` im `oneshot` `None`, und die IP-Spalte bliebe ungeprüft.
/// Jeder Test nimmt eine eigene Adresse, weil die Login-Sperre prozessweit je IP zählt.
fn von(mut req: Request<Body>, ip: &str) -> Request<Body> {
    let adresse: SocketAddr = format!("{ip}:40000").parse().unwrap();
    req.extensions_mut().insert(ConnectInfo(adresse));
    req
}

/// Alle `Set-Cookie`-Werte als `name=wert`-Paare (ohne Attribute).
fn cookie_paare(resp: &axum::response::Response) -> Vec<String> {
    resp.headers()
        .get_all(header::SET_COOKIE)
        .iter()
        .map(|v| v.to_str().unwrap().split(';').next().unwrap().to_string())
        .collect()
}

fn b64url(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

// ----- Passwort mit TOTP -----

fn jetzt_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs()
}

/// Aktiviert TOTP für den Admin über den regulären Enroll-Flow; liefert das Secret.
async fn totp_fuer_admin_aktivieren(app: &axum::Router) -> String {
    let admin = common::login_cookie(app, "admin", "startpw12").await;
    let (status, json) =
        common::anfrage(app, "POST", "/api/auth/totp/enroll/start", &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    let secret = json["secret_base32"].as_str().unwrap().to_string();
    let code = lifeline_hub::auth::totp::generiere_code(&secret, jetzt_unix()).unwrap();
    let (status, _) = common::anfrage(
        app,
        "POST",
        "/api/auth/totp/enroll/finish",
        &admin,
        Some(&format!(r#"{{"code":"{code}"}}"#)),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    secret
}

/// Erster Schritt (Passwort) bis zum `mfa_pending`-Cookie; liefert dessen `name=wert`-Paar.
async fn passwort_schritt(app: &axum::Router, ip: &str) -> String {
    let resp = app
        .clone()
        .oneshot(von(
            Request::builder()
                .method("POST")
                .uri("/api/auth/login")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    r#"{"benutzername":"admin","passwort":"startpw12"}"#,
                ))
                .unwrap(),
            ip,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    cookie_paare(&resp)
        .into_iter()
        .find(|c| c.starts_with("mfa_pending="))
        .expect("TOTP-Nutzer bekommt ein mfa_pending-Cookie")
}

async fn totp_finish(app: &axum::Router, pending: &str, code: &str, ip: &str) -> StatusCode {
    app.clone()
        .oneshot(von(
            Request::builder()
                .method("POST")
                .uri("/api/auth/totp/finish")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, pending)
                .body(Body::from(format!(r#"{{"code":"{code}"}}"#)))
                .unwrap(),
            ip,
        ))
        .await
        .unwrap()
        .status()
}

#[tokio::test]
async fn passwort_mit_totp_schreibt_login_ok_erst_nach_dem_zweiten_faktor() {
    let (app, pool) = setup_mit_pool().await;
    let secret = totp_fuer_admin_aktivieren(&app).await;
    let id = admin_id(&pool).await;
    spur_leeren(&pool).await;

    let pending = passwort_schritt(&app, "203.0.113.61").await;
    assert!(
        zeilen(&pool).await.is_empty(),
        "nach dem Passwort allein ist noch niemand angemeldet, also kein login_ok"
    );

    let code = lifeline_hub::auth::totp::generiere_code(&secret, jetzt_unix()).unwrap();
    let status = totp_finish(&app, &pending, &code, "203.0.113.61").await;
    assert_eq!(status, StatusCode::OK);

    assert_eq!(
        zeilen(&pool).await,
        vec![(
            "login_ok".to_string(),
            Some("admin".to_string()),
            Some(id),
            Some("203.0.113.61".to_string()),
            "passwort".to_string(),
        )],
        "die Anmeldung eines TOTP-Nutzers muss im Audit stehen, mit Anbieter passwort"
    );
}

#[tokio::test]
async fn falscher_totp_code_schreibt_login_fehlgeschlagen_mit_dem_konto() {
    let (app, pool) = setup_mit_pool().await;
    let secret = totp_fuer_admin_aktivieren(&app).await;
    let id = admin_id(&pool).await;
    spur_leeren(&pool).await;

    let pending = passwort_schritt(&app, "203.0.113.62").await;
    // Garantiert falsch: keiner der drei im ±1-Schritt gültigen Codes.
    let jetzt = jetzt_unix();
    let gueltig: Vec<String> = [jetzt - 30, jetzt, jetzt + 30]
        .into_iter()
        .map(|t| lifeline_hub::auth::totp::generiere_code(&secret, t).unwrap())
        .collect();
    let falsch = (0..10u32)
        .map(|n| n.to_string().repeat(6))
        .find(|c| !gueltig.contains(c))
        .unwrap();

    let status = totp_finish(&app, &pending, &falsch, "203.0.113.62").await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    assert_eq!(
        zeilen(&pool).await,
        vec![(
            "login_fehlgeschlagen".to_string(),
            Some("admin".to_string()),
            Some(id),
            Some("203.0.113.62".to_string()),
            "passwort".to_string(),
        )]
    );
}

// ----- Passkey, benutzergebunden -----

/// Echter Passkey zu einem P-256-Schlüssel, dessen privaten Teil der Test hält: so lässt sich
/// eine gültige Assertion ohne Authenticator signieren. WebAuthn verlangt ES256 als
/// ASN.1-DER-Signatur, genau das liefert `rcgen` für `PKCS_ECDSA_P256_SHA256`.
fn passkey_mit_schluessel(cred_id: &[u8]) -> (webauthn_rs::prelude::Passkey, rcgen::KeyPair) {
    use webauthn_rs::prelude::Credential;
    use webauthn_rs_core::proto::{
        AttestationFormat, COSEAlgorithm, COSEEC2Key, COSEKey, COSEKeyType, ECDSACurve,
        ParsedAttestation, RegisteredExtensions, UserVerificationPolicy,
    };

    let schluessel = rcgen::KeyPair::generate_for(&rcgen::PKCS_ECDSA_P256_SHA256).unwrap();
    // Unkomprimierter Punkt: 0x04 ‖ x ‖ y.
    let punkt = schluessel.public_key_raw();
    assert_eq!(punkt.len(), 65);
    let cred = Credential {
        cred_id: cred_id.to_vec().into(),
        cred: COSEKey {
            type_: COSEAlgorithm::ES256,
            key: COSEKeyType::EC_EC2(COSEEC2Key {
                curve: ECDSACurve::SECP256R1,
                x: punkt[1..33].to_vec().into(),
                y: punkt[33..65].to_vec().into(),
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
    };
    (webauthn_rs::prelude::Passkey::from(cred), schluessel)
}

#[tokio::test]
async fn benutzergebundener_passkey_schreibt_login_ok() {
    use rcgen::SigningKey;

    lifeline_hub::auth::provider::registry::set_webauthn_konfiguriert(true);
    lifeline_hub::auth::webauthn::set_webauthn(
        lifeline_hub::auth::webauthn::baue("localhost", "https://localhost").unwrap(),
    );
    let (app, pool) = setup_mit_pool().await;
    let id = admin_id(&pool).await;
    let cred_id = [0x4c, 0x46, 0x48, 0x08, 0x46];
    let (passkey, schluessel) = passkey_mit_schluessel(&cred_id);
    lifeline_hub::auth::webauthn::storage::speichere_passkey(&pool, id, &passkey)
        .await
        .unwrap();

    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/webauthn/auth/start")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(r#"{"benutzername":"admin"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let zustand = cookie_paare(&resp)
        .into_iter()
        .find(|c| c.starts_with("webauthn_auth="))
        .expect("auth/start setzt das webauthn_auth-Cookie");
    let json: serde_json::Value =
        serde_json::from_slice(&to_bytes(resp.into_body(), usize::MAX).await.unwrap()).unwrap();
    let challenge = json["publicKey"]["challenge"].as_str().unwrap();

    // Authenticator-Daten: rpIdHash ‖ Flags (UP | UV) ‖ Zähler 1.
    let mut auth_data = sha2::Sha256::digest(b"localhost").to_vec();
    auth_data.push(0x05);
    auth_data.extend_from_slice(&1u32.to_be_bytes());
    let client_data = format!(
        r#"{{"type":"webauthn.get","challenge":"{challenge}","origin":"https://localhost","crossOrigin":false}}"#
    );
    let mut signiert = auth_data.clone();
    signiert.extend_from_slice(&sha2::Sha256::digest(client_data.as_bytes()));
    let signatur = schluessel.sign(&signiert).unwrap();

    let assertion = serde_json::json!({
        "id": b64url(&cred_id),
        "rawId": b64url(&cred_id),
        "response": {
            "authenticatorData": b64url(&auth_data),
            "clientDataJSON": b64url(client_data.as_bytes()),
            "signature": b64url(&signatur),
            "userHandle": null,
        },
        "type": "public-key",
    });
    spur_leeren(&pool).await;
    let resp = app
        .clone()
        .oneshot(von(
            Request::builder()
                .method("POST")
                .uri("/api/auth/webauthn/auth/finish")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, zustand)
                .body(Body::from(assertion.to_string()))
                .unwrap(),
            "203.0.113.63",
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert!(cookie_paare(&resp)
        .iter()
        .any(|c| c.starts_with("lifeline_sid=")));

    assert_eq!(
        zeilen(&pool).await,
        vec![(
            "login_ok".to_string(),
            Some("admin".to_string()),
            Some(id),
            Some("203.0.113.63".to_string()),
            "webauthn".to_string(),
        )],
        "der benutzergebundene Passkey protokolliert wie der discoverable mit Anbieter webauthn"
    );
}

// ----- OIDC -----

/// Minimaler IdP für den Rückweg: Discovery, JWKS und Token-Endpunkt auf `127.0.0.1`. Die
/// OIDC-Einstellungen sind prozessweit (`OnceLock`), deshalb gibt es genau einen IdP je
/// Testprozess, in einem eigenen Thread mit eigener Runtime: ein Server in der Runtime eines
/// `#[tokio::test]` stürbe mit dessen Ende, und der nächste Test fände ihn nicht mehr.
struct TestIdp {
    issuer: String,
    schluessel: aws_lc_rs::rsa::KeyPair,
    /// `code` → `id_token`, vom Test vor dem Callback hinterlegt.
    tokens: std::sync::Arc<std::sync::Mutex<std::collections::HashMap<String, String>>>,
}

const OIDC_CLIENT_ID: &str = "lfh-846-test";

/// Liest ein DER-Element ab `pos`: (Tag, Inhalt, Position danach).
fn der_element(der: &[u8], pos: usize) -> (u8, &[u8], usize) {
    let tag = der[pos];
    let mut i = pos + 1;
    let mut laenge = der[i] as usize;
    i += 1;
    if laenge & 0x80 != 0 {
        let bytes = laenge & 0x7f;
        laenge = der[i..i + bytes]
            .iter()
            .fold(0usize, |acc, b| (acc << 8) | *b as usize);
        i += bytes;
    }
    (tag, &der[i..i + laenge], i + laenge)
}

/// JWK aus dem PKCS#1-`RSAPublicKey` (`SEQUENCE { n INTEGER, e INTEGER }`).
fn rsa_jwk(schluessel: &aws_lc_rs::rsa::KeyPair) -> serde_json::Value {
    use aws_lc_rs::signature::KeyPair;
    let (_, folge, _) = der_element(schluessel.public_key().as_ref(), 0);
    let (_, n, weiter) = der_element(folge, 0);
    let (_, e, _) = der_element(folge, weiter);
    // DER stellt einem Integer mit gesetztem Höchstbit eine 0 voran; JWK will sie nicht.
    let ohne_null = |b: &[u8]| {
        b.iter()
            .skip_while(|x| **x == 0)
            .copied()
            .collect::<Vec<_>>()
    };
    serde_json::json!({
        "kty": "RSA", "use": "sig", "alg": "RS256", "kid": "lfh-846",
        "n": b64url(&ohne_null(n)), "e": b64url(&ohne_null(e)),
    })
}

fn test_idp() -> &'static TestIdp {
    static IDP: std::sync::OnceLock<TestIdp> = std::sync::OnceLock::new();
    IDP.get_or_init(|| {
        use axum::routing::{get, post};

        let schluessel =
            aws_lc_rs::rsa::KeyPair::generate(aws_lc_rs::rsa::KeySize::Rsa2048).unwrap();
        let jwks = serde_json::json!({ "keys": [rsa_jwk(&schluessel)] });
        let tokens = std::sync::Arc::new(std::sync::Mutex::new(std::collections::HashMap::<
            String,
            String,
        >::new()));

        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let issuer = format!("http://{}", listener.local_addr().unwrap());
        let discovery = serde_json::json!({
            "issuer": issuer,
            "authorization_endpoint": format!("{issuer}/authorize"),
            "token_endpoint": format!("{issuer}/token"),
            "jwks_uri": format!("{issuer}/jwks"),
            "response_types_supported": ["code"],
            "subject_types_supported": ["public"],
            "id_token_signing_alg_values_supported": ["RS256"],
        });

        let token_map = tokens.clone();
        let router = axum::Router::new()
            .route(
                "/.well-known/openid-configuration",
                get(move || async move { axum::Json(discovery) }),
            )
            .route("/jwks", get(move || async move { axum::Json(jwks) }))
            .route(
                "/token",
                post(
                    move |axum::Form(form): axum::Form<
                        std::collections::HashMap<String, String>,
                    >| async move {
                        let id_token = form
                            .get("code")
                            .and_then(|c| token_map.lock().unwrap().remove(c));
                        match id_token {
                            Some(id_token) => axum::Json(serde_json::json!({
                                "access_token": "zugang",
                                "token_type": "Bearer",
                                "expires_in": 300,
                                "id_token": id_token,
                            }))
                            .into_response(),
                            None => (
                                StatusCode::BAD_REQUEST,
                                axum::Json(serde_json::json!({ "error": "invalid_grant" })),
                            )
                                .into_response(),
                        }
                    },
                ),
            );
        std::thread::spawn(move || {
            tokio::runtime::Runtime::new()
                .unwrap()
                .block_on(async move {
                    let listener = tokio::net::TcpListener::from_std(listener).unwrap();
                    axum::serve(listener, router).await.unwrap();
                });
        });

        lifeline_hub::auth::provider::registry::set_oidc_konfiguriert(true);
        lifeline_hub::auth::oidc::init_oidc_settings(lifeline_hub::auth::oidc::OidcSettings {
            issuer: Some(issuer.clone()),
            client_id: Some(OIDC_CLIENT_ID.to_string()),
            client_secret: Some(lifeline_hub::config::GeheimesPasswort("geheim".to_string())),
            redirect_url: Some("http://localhost/api/auth/oidc/callback".to_string()),
        });

        TestIdp {
            issuer,
            schluessel,
            tokens,
        }
    })
}

impl TestIdp {
    /// Signiert ein `id_token` (RS256) für `sub` und hinterlegt es unter `code`.
    fn token_hinterlegen(&self, code: &str, sub: &str, name: &str, nonce: &str) {
        let jetzt = jetzt_unix();
        let kopf = b64url(br#"{"alg":"RS256","kid":"lfh-846"}"#);
        let claims = b64url(
            serde_json::json!({
                "iss": self.issuer, "aud": OIDC_CLIENT_ID, "sub": sub,
                "preferred_username": name, "nonce": nonce,
                "iat": jetzt, "exp": jetzt + 300,
            })
            .to_string()
            .as_bytes(),
        );
        let mut signatur = vec![0u8; self.schluessel.public_modulus_len()];
        self.schluessel
            .sign(
                &aws_lc_rs::signature::RSA_PKCS1_SHA256,
                &aws_lc_rs::rand::SystemRandom::new(),
                format!("{kopf}.{claims}").as_bytes(),
                &mut signatur,
            )
            .unwrap();
        self.tokens.lock().unwrap().insert(
            code.to_string(),
            format!("{kopf}.{claims}.{}", b64url(&signatur)),
        );
    }
}

/// Legt einen vom Server „begonnenen“ Flow in den State-Store (wie `oidc_start`, aber ohne
/// Browser) und ruft den Callback mit passendem Binding-Cookie auf. Liefert den Redirect-Ziel.
async fn oidc_rueckweg(app: &axum::Router, state_key: &str, code: &str, ip: &str) -> String {
    lifeline_hub::auth::oidc::state::speichere(
        state_key.to_string(),
        lifeline_hub::auth::oidc::state::StateEintrag {
            nonce: format!("nonce-{state_key}"),
            pkce_verifier: "v".repeat(43),
            ziel_pfad: "/einsaetze".to_string(),
        },
    );
    let resp = app
        .clone()
        .oneshot(von(
            Request::builder()
                .uri(format!(
                    "/api/auth/oidc/callback?code={code}&state={state_key}"
                ))
                .header(header::COOKIE, format!("oidc_state={state_key}"))
                .body(Body::empty())
                .unwrap(),
            ip,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::SEE_OTHER);
    resp.headers()
        .get(header::LOCATION)
        .unwrap()
        .to_str()
        .unwrap()
        .to_string()
}

#[tokio::test]
async fn oidc_anmeldung_schreibt_login_ok_fuer_das_jit_konto() {
    let idp = test_idp();
    let (app, pool) = setup_mit_pool().await;
    spur_leeren(&pool).await;

    idp.token_hinterlegen("code-ok", "sub-neu", "sso.neu", "nonce-state-ok");
    let ziel = oidc_rueckweg(&app, "state-ok", "code-ok", "203.0.113.64").await;
    assert_eq!(ziel, "/einsaetze", "Anmeldung muss gelingen");

    let (id, name): (i64, String) =
        sqlx::query_as("SELECT id, benutzername FROM benutzer WHERE oidc_subject = 'sub-neu'")
            .fetch_one(&pool)
            .await
            .expect("das JIT-Konto ist angelegt");
    assert_eq!(
        zeilen(&pool).await,
        vec![(
            "login_ok".to_string(),
            Some(name),
            Some(id),
            Some("203.0.113.64".to_string()),
            "oidc".to_string(),
        )],
        "eine SSO-Anmeldung muss im Audit stehen, mit Anbieter oidc"
    );
}

#[tokio::test]
async fn oidc_mit_deaktiviertem_konto_schreibt_login_fehlgeschlagen_mit_dem_konto() {
    let idp = test_idp();
    let (app, pool) = setup_mit_pool().await;
    let konto = lifeline_hub::auth::oidc::provisioning::finde_oder_provisioniere(
        &pool,
        &lifeline_hub::auth::oidc::provisioning::OidcClaims {
            issuer: idp.issuer.clone(),
            subject: "sub-gesperrt".to_string(),
            preferred_username: Some("sso.gesperrt".to_string()),
            name: None,
        },
    )
    .await
    .unwrap();
    sqlx::query("UPDATE benutzer SET aktiv = 0 WHERE id = ?")
        .bind(konto.id)
        .execute(&pool)
        .await
        .unwrap();
    spur_leeren(&pool).await;

    idp.token_hinterlegen(
        "code-gesperrt",
        "sub-gesperrt",
        "sso.gesperrt",
        "nonce-state-gesperrt",
    );
    let ziel = oidc_rueckweg(&app, "state-gesperrt", "code-gesperrt", "203.0.113.65").await;
    assert_eq!(ziel, "/login?fehler=oidc");

    assert_eq!(
        zeilen(&pool).await,
        vec![(
            "login_fehlgeschlagen".to_string(),
            Some(konto.benutzername.clone()),
            Some(konto.id),
            Some("203.0.113.65".to_string()),
            "oidc".to_string(),
        )]
    );
}

#[tokio::test]
async fn oidc_mit_abgelehntem_code_schreibt_login_fehlgeschlagen_ohne_konto() {
    test_idp();
    let (app, pool) = setup_mit_pool().await;
    spur_leeren(&pool).await;

    // Kein Token hinterlegt: der IdP lehnt den Code ab, der Token-Tausch scheitert.
    let ziel = oidc_rueckweg(&app, "state-abgelehnt", "code-unbekannt", "203.0.113.66").await;
    assert_eq!(ziel, "/login?fehler=oidc");

    assert_eq!(
        zeilen(&pool).await,
        vec![(
            "login_fehlgeschlagen".to_string(),
            None,
            None,
            Some("203.0.113.66".to_string()),
            "oidc".to_string(),
        )]
    );
}

#[tokio::test]
async fn oidc_rueckweg_ohne_begonnenen_flow_protokolliert_nichts() {
    // Unbekannter `state`: dieser Server hat nichts begonnen. Ein öffentlicher GET ohne
    // Rate-Limit darf die Tabelle nicht füllen (s. `routes::auth::oidc_fehlschlag`).
    test_idp();
    let (app, pool) = setup_mit_pool().await;
    spur_leeren(&pool).await;

    let resp = app
        .clone()
        .oneshot(von(
            Request::builder()
                .uri("/api/auth/oidc/callback?code=x&state=nie-begonnen")
                .header(header::COOKIE, "oidc_state=nie-begonnen")
                .body(Body::empty())
                .unwrap(),
            "203.0.113.67",
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::SEE_OTHER);
    assert!(zeilen(&pool).await.is_empty());
}

// ----- Guard: kein Weg zur Sitzung ohne Audit -----

/// Zeilenanfänge, die eine Funktion beginnen. Bewusst ohne `regex`, wie die übrigen Guards.
fn ist_fn_anfang(zeile: &str) -> bool {
    let t = zeile.trim_start();
    [
        "fn ",
        "async fn ",
        "pub fn ",
        "pub async fn ",
        "pub(crate) fn ",
        "pub(crate) async fn ",
    ]
    .iter()
    .any(|p| t.starts_with(p))
}

/// Funktionen in `quelle`, die `session::anlegen(` aufrufen, ohne im selben Rumpf ein
/// `login_ok` zu schreiben. Liefert (Kopfzeile, Anzahl Aufrufe gesamt). Kommentarzeilen zählen
/// nicht; ab `#[cfg(test)]` endet der Produktionscode der Datei.
fn anlegen_ohne_audit(quelle: &str) -> (Vec<String>, usize) {
    let zeilen: Vec<&str> = quelle
        .lines()
        .take_while(|z| z.trim() != "#[cfg(test)]")
        .collect();
    let mut verstoesse = Vec::new();
    let mut aufrufe = 0;
    for (i, zeile) in zeilen.iter().enumerate() {
        if zeile.trim_start().starts_with("//") || !zeile.contains("session::anlegen(") {
            continue;
        }
        aufrufe += 1;
        let anfang = (0..=i)
            .rev()
            .find(|&j| ist_fn_anfang(zeilen[j]))
            .unwrap_or(0);
        let ende = (i + 1..zeilen.len())
            .find(|&j| ist_fn_anfang(zeilen[j]))
            .unwrap_or(zeilen.len());
        let rumpf = zeilen[anfang..ende].join("\n");
        if !(rumpf.contains("audit::schreibe(") && rumpf.contains("Ereignis::LoginOk")) {
            verstoesse.push(zeilen[anfang].trim().to_string());
        }
    }
    (verstoesse, aufrufe)
}

fn rs_dateien(verzeichnis: &std::path::Path, ziel: &mut Vec<std::path::PathBuf>) {
    for eintrag in std::fs::read_dir(verzeichnis)
        .unwrap()
        .filter_map(Result::ok)
    {
        let pfad = eintrag.path();
        if pfad.is_dir() {
            rs_dateien(&pfad, ziel);
        } else if pfad.extension().is_some_and(|e| e == "rs") {
            ziel.push(pfad);
        }
    }
}

#[test]
fn jeder_handler_mit_session_anlegen_schreibt_login_ok() {
    let mut dateien = Vec::new();
    rs_dateien(std::path::Path::new("src"), &mut dateien);
    dateien.sort();

    let mut verstoesse = Vec::new();
    let mut aufrufe = 0;
    for pfad in &dateien {
        let (treffer, anzahl) = anlegen_ohne_audit(&std::fs::read_to_string(pfad).unwrap());
        aufrufe += anzahl;
        verstoesse.extend(
            treffer
                .into_iter()
                .map(|t| format!("{}: {t}", pfad.display())),
        );
    }

    // Login, OIDC, Passkey (benutzergebunden und discoverable), TOTP, Systembrowser.
    assert!(
        aufrufe >= 6,
        "Guard fand nur {aufrufe} Aufrufe von session::anlegen — Pfad oder Muster kaputt?"
    );
    assert!(
        verstoesse.is_empty(),
        "Diese Funktionen legen eine Sitzung an, ohne `login_ok` ins Auth-Audit zu schreiben \
         (LFH-846, `auth::audit::schreibe` mit `Ereignis::LoginOk` und dem Anbieter):\n{}",
        verstoesse.join("\n")
    );
}

/// Der Guard muss greifen, nicht nur per Konstruktion grün sein.
#[test]
fn guard_erkennt_sitzung_ohne_audit() {
    let ohne = r#"
pub async fn neuer_weg(State(state): State<AppState>) -> Result<(), AppError> {
    // session::anlegen(&state.pool, 1) steht hier nur im Kommentar.
    let token = session::anlegen(&state.pool, 1).await?;
    Ok(())
}

pub async fn sauber(State(state): State<AppState>) -> Result<(), AppError> {
    let token = session::anlegen(&state.pool, 1).await?;
    crate::auth::audit::schreibe(&state.pool, AuditEintrag {
        ereignis: crate::auth::audit::Ereignis::LoginOk,
    }).await;
    Ok(())
}

#[cfg(test)]
mod tests {
    async fn hilfe() { session::anlegen(&pool, 1).await.unwrap(); }
}
"#;
    let (verstoesse, aufrufe) = anlegen_ohne_audit(ohne);
    assert_eq!(aufrufe, 2, "Kommentar und Testmodul zählen nicht");
    assert_eq!(
        verstoesse,
        vec!["pub async fn neuer_weg(State(state): State<AppState>) -> Result<(), AppError> {"]
    );
}
