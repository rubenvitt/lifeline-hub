//! Auth-Audit je Anmeldeweg über den echten Router (LFH-792).
//!
//! `tests/auth_audit.rs` deckt den Passwort-Login ab. Hier stehen die übrigen Wege: TOTP als
//! zweiter Schritt, OIDC und Passkey. Jeder Test leert die Spur unmittelbar vor dem Schritt,
//! um den es geht, und verlangt danach GENAU einen Eintrag — ein fehlender verbirgt ein
//! Durchprobieren, ein doppelter verfälscht jede Zählung. Eine Abweisung ohne laufende
//! Zeremonie und ein gestörter IdP schreiben dagegen KEINEN: sonst füllte jede Anfrage ohne
//! Vorlauf die Tabelle.
//!
//! Damit Erfolg und Fehlschlag ohne äußeren Dienst echt durchlaufen, signiert der Test selbst:
//! einen Passkey mit einem frischen P-256-Schlüssel und das `id_token` eines Mini-IdP, der in
//! einem eigenen Thread läuft. Die OIDC-Einstellungen und der Discovery-Cache sind prozessweit;
//! deshalb steht das in einer eigenen Testdatei (eigener Prozess) und nicht in `tests/auth.rs`.

use axum::body::{to_bytes, Body};
use axum::extract::connect_info::ConnectInfo;
use axum::http::{header, Request, StatusCode};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use sha2::{Digest, Sha256};
use std::net::SocketAddr;
use std::sync::LazyLock;
use tower::ServiceExt;

mod common;
use common::{anfrage, login_cookie, setup_mit_pool};

/// Gegenstelle aller Anfragen dieser Datei; die Spur muss sie tragen.
const PEER: &str = "198.51.100.7:40000";

/// Ein Audit-Eintrag, wie ihn die Tests vergleichen.
#[derive(Debug, Clone, PartialEq, sqlx::FromRow)]
struct Eintrag {
    ereignis: String,
    provider: String,
    benutzername: Option<String>,
    benutzer_id: Option<i64>,
    peer_ip: Option<String>,
}

async fn spur(pool: &sqlx::SqlitePool) -> Vec<Eintrag> {
    sqlx::query_as(
        "SELECT ereignis, provider, benutzername, benutzer_id, peer_ip FROM auth_audit ORDER BY id",
    )
    .fetch_all(pool)
    .await
    .unwrap()
}

async fn spur_leeren(pool: &sqlx::SqlitePool) {
    sqlx::query("DELETE FROM auth_audit")
        .execute(pool)
        .await
        .unwrap();
}

async fn benutzer_id(pool: &sqlx::SqlitePool, benutzername: &str) -> i64 {
    sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername = ?")
        .bind(benutzername)
        .fetch_one(pool)
        .await
        .unwrap()
}

fn erfolg(provider: &str, benutzername: &str, id: i64) -> Eintrag {
    Eintrag {
        ereignis: "login_ok".to_string(),
        provider: provider.to_string(),
        benutzername: Some(benutzername.to_string()),
        benutzer_id: Some(id),
        peer_ip: Some("198.51.100.7".to_string()),
    }
}

fn fehlschlag(provider: &str, benutzer: Option<(&str, i64)>) -> Eintrag {
    Eintrag {
        ereignis: "login_fehlgeschlagen".to_string(),
        provider: provider.to_string(),
        benutzername: benutzer.map(|(name, _)| name.to_string()),
        benutzer_id: benutzer.map(|(_, id)| id),
        peer_ip: Some("198.51.100.7".to_string()),
    }
}

/// Antwort einer Anfrage: Status, alle `Set-Cookie`-Werte, Body als JSON, `Location`.
struct Antwort {
    status: StatusCode,
    cookies: Vec<String>,
    json: serde_json::Value,
    location: Option<String>,
}

/// Schickt eine Anfrage mit fester Gegenstelle ([`PEER`]).
async fn sende(
    app: &axum::Router,
    methode: &str,
    uri: &str,
    cookie: Option<&str>,
    body: Option<String>,
) -> Antwort {
    let mut req = Request::builder().method(methode).uri(uri);
    if let Some(cookie) = cookie {
        req = req.header(header::COOKIE, cookie);
    }
    if body.is_some() {
        req = req.header(header::CONTENT_TYPE, "application/json");
    }
    let mut req = req
        .body(body.map(Body::from).unwrap_or_else(Body::empty))
        .unwrap();
    req.extensions_mut()
        .insert(ConnectInfo::<SocketAddr>(PEER.parse().unwrap()));
    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let cookies = resp
        .headers()
        .get_all(header::SET_COOKIE)
        .iter()
        .map(|v| v.to_str().unwrap().to_string())
        .collect();
    let location = resp
        .headers()
        .get(header::LOCATION)
        .map(|v| v.to_str().unwrap().to_string());
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json = serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null);
    Antwort {
        status,
        cookies,
        json,
        location,
    }
}

/// `name=wert` des Cookies `name` aus den `Set-Cookie`-Werten.
fn cookie_paar(cookies: &[String], name: &str) -> String {
    cookies
        .iter()
        .find(|c| c.starts_with(&format!("{name}=")))
        .unwrap_or_else(|| panic!("Cookie {name} erwartet, war: {cookies:?}"))
        .split(';')
        .next()
        .unwrap()
        .to_string()
}

fn jetzt_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs()
}

// ===== TOTP =====

/// Aktiviert TOTP für den admin über den regulären Enroll-Flow; liefert das Secret.
async fn totp_fuer_admin(app: &axum::Router) -> String {
    let admin = login_cookie(app, "admin", "startpw12").await;
    let (status, json) = anfrage(app, "POST", "/api/auth/totp/enroll/start", &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    let secret = json["secret_base32"].as_str().unwrap().to_string();
    let code = lifeline_hub::auth::totp::generiere_code(&secret, jetzt_unix()).unwrap();
    let (status, _) = anfrage(
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

/// Passwortschritt eines TOTP-Nutzers; liefert das `mfa_pending`-Cookie-Paar.
async fn passwortschritt(app: &axum::Router) -> String {
    let antwort = sende(
        app,
        "POST",
        "/api/auth/login",
        None,
        Some(r#"{"benutzername":"admin","passwort":"startpw12"}"#.to_string()),
    )
    .await;
    assert_eq!(antwort.status, StatusCode::OK);
    assert_eq!(antwort.json["mfa_erforderlich"], "totp");
    cookie_paar(&antwort.cookies, "mfa_pending")
}

#[tokio::test]
async fn totp_anmeldung_hinterlaesst_genau_einen_login_ok() {
    let (app, pool) = setup_mit_pool().await;
    let secret = totp_fuer_admin(&app).await;
    let id = benutzer_id(&pool, "admin").await;
    spur_leeren(&pool).await;

    // Der Passwortschritt allein meldet noch niemanden an und schreibt deshalb nichts.
    let pending = passwortschritt(&app).await;
    // Der Code des nächsten Zeitschritts: den aktuellen hat das Enrollment schon verbraucht
    // (Replay-Schutz, LFH-791), der nächste liegt im ±1-Skew.
    let code = lifeline_hub::auth::totp::generiere_code(&secret, jetzt_unix() + 30).unwrap();
    let antwort = sende(
        &app,
        "POST",
        "/api/auth/totp/finish",
        Some(&pending),
        Some(format!(r#"{{"code":"{code}"}}"#)),
    )
    .await;
    assert_eq!(antwort.status, StatusCode::OK);

    assert_eq!(spur(&pool).await, vec![erfolg("totp", "admin", id)]);
}

#[tokio::test]
async fn falscher_totp_code_hinterlaesst_genau_einen_fehlschlag_mit_benutzer() {
    let (app, pool) = setup_mit_pool().await;
    let secret = totp_fuer_admin(&app).await;
    let id = benutzer_id(&pool, "admin").await;
    spur_leeren(&pool).await;

    let pending = passwortschritt(&app).await;
    // Ein Code, der in keinem der drei geprüften Zeitschritte gilt.
    let gueltige: Vec<String> = [jetzt_unix() - 30, jetzt_unix(), jetzt_unix() + 30]
        .iter()
        .map(|t| lifeline_hub::auth::totp::generiere_code(&secret, *t).unwrap())
        .collect();
    let falsch = (0..1_000_000)
        .map(|n| format!("{n:06}"))
        .find(|c| !gueltige.contains(c))
        .unwrap();
    let antwort = sende(
        &app,
        "POST",
        "/api/auth/totp/finish",
        Some(&pending),
        Some(format!(r#"{{"code":"{falsch}"}}"#)),
    )
    .await;
    assert_eq!(antwort.status, StatusCode::UNAUTHORIZED);

    // Wer am Zweitfaktor scheitert, hat das Passwort schon bestanden: die Spur nennt ihn, sonst
    // bliebe das Durchprobieren seines Zweitfaktors unzuordenbar.
    assert_eq!(
        spur(&pool).await,
        vec![fehlschlag("totp", Some(("admin", id)))]
    );
}

#[tokio::test]
async fn gesperrter_zweitfaktor_hinterlaesst_keinen_weiteren_eintrag() {
    let (app, pool) = setup_mit_pool().await;
    let secret = totp_fuer_admin(&app).await;
    let id = benutzer_id(&pool, "admin").await;
    spur_leeren(&pool).await;

    let gueltige: Vec<String> = [jetzt_unix() - 30, jetzt_unix(), jetzt_unix() + 30]
        .iter()
        .map(|t| lifeline_hub::auth::totp::generiere_code(&secret, *t).unwrap())
        .collect();
    let falsch = (0..1_000_000)
        .map(|n| format!("{n:06}"))
        .find(|c| !gueltige.contains(c))
        .unwrap();
    let max = lifeline_hub::auth::totp::schutz::MAX_FEHLVERSUCHE as usize;

    // Jeder falsche Code bis zur Sperre ist ein gescheiterter Versuch mit Eintrag; danach weist
    // die Sperre (LFH-791) mit 429 ab, und die Tabelle wächst nicht weiter.
    for versuch in 0..=max {
        let pending = passwortschritt(&app).await;
        let antwort = sende(
            &app,
            "POST",
            "/api/auth/totp/finish",
            Some(&pending),
            Some(format!(r#"{{"code":"{falsch}"}}"#)),
        )
        .await;
        let erwartet = if versuch < max {
            StatusCode::UNAUTHORIZED
        } else {
            StatusCode::TOO_MANY_REQUESTS
        };
        assert_eq!(antwort.status, erwartet, "Versuch {versuch}");
    }

    assert_eq!(
        spur(&pool).await,
        vec![fehlschlag("totp", Some(("admin", id))); max]
    );
}

#[tokio::test]
async fn totp_abschluss_ohne_laufende_anmeldung_hinterlaesst_keinen_eintrag() {
    let (app, pool) = setup_mit_pool().await;

    let antwort = sende(
        &app,
        "POST",
        "/api/auth/totp/finish",
        Some("mfa_pending=unbekannt"),
        Some(r#"{"code":"123456"}"#.to_string()),
    )
    .await;
    assert_eq!(antwort.status, StatusCode::UNAUTHORIZED);

    assert_eq!(spur(&pool).await, vec![]);
}

#[tokio::test]
async fn totp_abschluss_fuer_deaktiviertes_konto_nennt_den_benutzer() {
    let (app, pool) = setup_mit_pool().await;
    let secret = totp_fuer_admin(&app).await;
    let id = benutzer_id(&pool, "admin").await;
    let pending = passwortschritt(&app).await;
    // Zwischen Passwortschritt und Zweitfaktor deaktiviert.
    sqlx::query("UPDATE benutzer SET aktiv = 0 WHERE id = ?")
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();
    spur_leeren(&pool).await;

    let code = lifeline_hub::auth::totp::generiere_code(&secret, jetzt_unix() + 30).unwrap();
    let antwort = sende(
        &app,
        "POST",
        "/api/auth/totp/finish",
        Some(&pending),
        Some(format!(r#"{{"code":"{code}"}}"#)),
    )
    .await;
    assert_eq!(antwort.status, StatusCode::UNAUTHORIZED);

    assert_eq!(
        spur(&pool).await,
        vec![fehlschlag("totp", Some(("admin", id)))]
    );
}

// ===== Passkey =====

const RP_ID: &str = "localhost";
const RP_ORIGIN: &str = "https://localhost";

fn webauthn_aktivieren() {
    lifeline_hub::auth::provider::registry::set_webauthn_konfiguriert(true);
    lifeline_hub::auth::webauthn::set_webauthn(
        lifeline_hub::auth::webauthn::baue(RP_ID, RP_ORIGIN).unwrap(),
    );
}

/// Ein Passkey mit echtem P-256-Schlüssel: der Test kann damit gültige Assertions signieren.
struct TestPasskey {
    cred_id: Vec<u8>,
    schluessel: openssl::ec::EcKey<openssl::pkey::Private>,
}

impl TestPasskey {
    fn neu(cred_id: &[u8]) -> Self {
        let gruppe =
            openssl::ec::EcGroup::from_curve_name(openssl::nid::Nid::X9_62_PRIME256V1).unwrap();
        Self {
            cred_id: cred_id.to_vec(),
            schluessel: openssl::ec::EcKey::generate(&gruppe).unwrap(),
        }
    }

    /// Der serverseitige `Passkey` zu diesem Schlüssel (über `danger-credential-internals`).
    fn als_passkey(&self) -> webauthn_rs::prelude::Passkey {
        use webauthn_rs_core::proto::{
            AttestationFormat, COSEAlgorithm, COSEEC2Key, COSEKey, COSEKeyType, Credential,
            ECDSACurve, ParsedAttestation, RegisteredExtensions, UserVerificationPolicy,
        };
        let gruppe = self.schluessel.group();
        let mut x = openssl::bn::BigNum::new().unwrap();
        let mut y = openssl::bn::BigNum::new().unwrap();
        let mut ctx = openssl::bn::BigNumContext::new().unwrap();
        self.schluessel
            .public_key()
            .affine_coordinates(gruppe, &mut x, &mut y, &mut ctx)
            .unwrap();
        let cred = Credential {
            cred_id: self.cred_id.clone().into(),
            cred: COSEKey {
                type_: COSEAlgorithm::ES256,
                key: COSEKeyType::EC_EC2(COSEEC2Key {
                    curve: ECDSACurve::SECP256R1,
                    x: x.to_vec_padded(32).unwrap().into(),
                    y: y.to_vec_padded(32).unwrap().into(),
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
        webauthn_rs::prelude::Passkey::from(cred)
    }

    /// Die Assertion auf `challenge` (base64url), signiert mit `signierer`; `user_handle` nur
    /// für den discoverable Login.
    fn assertion(
        &self,
        challenge: &str,
        signierer: &openssl::ec::EcKey<openssl::pkey::Private>,
        user_handle: Option<&[u8]>,
    ) -> String {
        let client_data = serde_json::json!({
            "type": "webauthn.get",
            "challenge": challenge,
            "origin": RP_ORIGIN,
            "crossOrigin": false,
        })
        .to_string();
        let mut auth_data = Sha256::digest(RP_ID.as_bytes()).to_vec();
        // UP | UV, Zähler 0 (wie ein synchronisierter Plattform-Passkey).
        auth_data.push(0x05);
        auth_data.extend_from_slice(&0u32.to_be_bytes());

        let mut signiert = auth_data.clone();
        signiert.extend_from_slice(&Sha256::digest(client_data.as_bytes()));
        let pkey = openssl::pkey::PKey::from_ec_key(signierer.clone()).unwrap();
        let mut signer =
            openssl::sign::Signer::new(openssl::hash::MessageDigest::sha256(), &pkey).unwrap();
        signer.update(&signiert).unwrap();
        let signatur = signer.sign_to_vec().unwrap();

        let id = URL_SAFE_NO_PAD.encode(&self.cred_id);
        serde_json::json!({
            "id": id,
            "rawId": id,
            "response": {
                "authenticatorData": URL_SAFE_NO_PAD.encode(&auth_data),
                "clientDataJSON": URL_SAFE_NO_PAD.encode(client_data.as_bytes()),
                "signature": URL_SAFE_NO_PAD.encode(&signatur),
                "userHandle": user_handle.map(|h| URL_SAFE_NO_PAD.encode(h)),
            },
            "type": "public-key",
        })
        .to_string()
    }
}

/// Legt für den admin einen Passkey an, startet die benutzergebundene Zeremonie und liefert
/// (Passkey, Challenge, `webauthn_auth`-Cookie-Paar).
async fn passkey_zeremonie(
    app: &axum::Router,
    pool: &sqlx::SqlitePool,
    cred_id: &[u8],
) -> (TestPasskey, String, String) {
    let passkey = TestPasskey::neu(cred_id);
    let id = benutzer_id(pool, "admin").await;
    lifeline_hub::auth::webauthn::storage::speichere_passkey(pool, id, &passkey.als_passkey())
        .await
        .unwrap();

    let antwort = sende(
        app,
        "POST",
        "/api/auth/webauthn/auth/start",
        None,
        Some(r#"{"benutzername":"admin"}"#.to_string()),
    )
    .await;
    assert_eq!(antwort.status, StatusCode::OK);
    let challenge = antwort.json["publicKey"]["challenge"]
        .as_str()
        .unwrap()
        .to_string();
    (
        passkey,
        challenge,
        cookie_paar(&antwort.cookies, "webauthn_auth"),
    )
}

#[tokio::test]
async fn passkey_anmeldung_hinterlaesst_genau_einen_login_ok() {
    webauthn_aktivieren();
    let (app, pool) = setup_mit_pool().await;
    let (passkey, challenge, cookie) = passkey_zeremonie(&app, &pool, b"passkey-erfolg").await;
    let id = benutzer_id(&pool, "admin").await;
    spur_leeren(&pool).await;

    let body = passkey.assertion(&challenge, &passkey.schluessel, None);
    let antwort = sende(
        &app,
        "POST",
        "/api/auth/webauthn/auth/finish",
        Some(&cookie),
        Some(body),
    )
    .await;
    assert_eq!(antwort.status, StatusCode::OK, "{:?}", antwort.json);

    assert_eq!(spur(&pool).await, vec![erfolg("webauthn", "admin", id)]);
}

#[tokio::test]
async fn passkey_mit_falscher_signatur_hinterlaesst_genau_einen_fehlschlag() {
    webauthn_aktivieren();
    let (app, pool) = setup_mit_pool().await;
    let (passkey, challenge, cookie) = passkey_zeremonie(&app, &pool, b"passkey-falsch").await;
    spur_leeren(&pool).await;

    // Signiert mit einem fremden Schlüssel: die Bibliothek weist die Assertion ab.
    let fremd = TestPasskey::neu(b"fremd");
    let body = passkey.assertion(&challenge, &fremd.schluessel, None);
    let antwort = sende(
        &app,
        "POST",
        "/api/auth/webauthn/auth/finish",
        Some(&cookie),
        Some(body),
    )
    .await;
    assert_eq!(antwort.status, StatusCode::UNAUTHORIZED);

    assert_eq!(spur(&pool).await, vec![fehlschlag("webauthn", None)]);
}

#[tokio::test]
async fn passkey_fuer_deaktiviertes_konto_nennt_den_benutzer() {
    webauthn_aktivieren();
    let (app, pool) = setup_mit_pool().await;
    let (passkey, challenge, cookie) = passkey_zeremonie(&app, &pool, b"passkey-inaktiv").await;
    let id = benutzer_id(&pool, "admin").await;
    sqlx::query("UPDATE benutzer SET aktiv = 0 WHERE id = ?")
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();
    spur_leeren(&pool).await;

    // Gültige Signatur: der Server weiß, wessen Passkey das ist, und nennt ihn.
    let body = passkey.assertion(&challenge, &passkey.schluessel, None);
    let antwort = sende(
        &app,
        "POST",
        "/api/auth/webauthn/auth/finish",
        Some(&cookie),
        Some(body),
    )
    .await;
    assert_eq!(antwort.status, StatusCode::UNAUTHORIZED);

    assert_eq!(
        spur(&pool).await,
        vec![fehlschlag("webauthn", Some(("admin", id)))]
    );
}

#[tokio::test]
async fn passkey_abschluss_ohne_laufende_zeremonie_hinterlaesst_keinen_eintrag() {
    webauthn_aktivieren();
    let (app, pool) = setup_mit_pool().await;
    let passkey = TestPasskey::neu(b"ohne-zeremonie");

    for pfad in [
        "/api/auth/webauthn/auth/finish",
        "/api/auth/webauthn/discoverable/finish",
    ] {
        let body = passkey.assertion("AAAA", &passkey.schluessel, None);
        let antwort = sende(&app, "POST", pfad, None, Some(body)).await;
        assert_eq!(antwort.status, StatusCode::UNAUTHORIZED, "{pfad}");
    }

    assert_eq!(spur(&pool).await, vec![]);
}

#[tokio::test]
async fn abgeschalteter_passkey_provider_hinterlaesst_keinen_eintrag() {
    webauthn_aktivieren();
    let (app, pool) = setup_mit_pool().await;
    sqlx::query(
        "INSERT INTO auth_provider (id, aktiviert) VALUES ('webauthn', 0) \
         ON CONFLICT(id) DO UPDATE SET aktiviert = 0",
    )
    .execute(&pool)
    .await
    .unwrap();
    let passkey = TestPasskey::neu(b"provider-aus");

    let body = passkey.assertion("AAAA", &passkey.schluessel, None);
    let antwort = sende(
        &app,
        "POST",
        "/api/auth/webauthn/auth/finish",
        Some("webauthn_auth=egal"),
        Some(body),
    )
    .await;
    assert_eq!(antwort.status, StatusCode::NOT_FOUND);

    assert_eq!(spur(&pool).await, vec![]);
}

/// Legt für den admin einen Passkey an, startet den discoverable Login und liefert
/// (Passkey, User-Handle, Challenge, `webauthn_disc`-Cookie-Paar).
async fn discoverable_zeremonie(
    app: &axum::Router,
    pool: &sqlx::SqlitePool,
    cred_id: &[u8],
) -> (TestPasskey, Vec<u8>, String, String) {
    let passkey = TestPasskey::neu(cred_id);
    let id = benutzer_id(pool, "admin").await;
    lifeline_hub::auth::webauthn::storage::speichere_passkey(pool, id, &passkey.als_passkey())
        .await
        .unwrap();
    let handle = lifeline_hub::auth::webauthn::user_handle(pool, id)
        .await
        .unwrap();

    let antwort = sende(
        app,
        "POST",
        "/api/auth/webauthn/discoverable/start",
        None,
        None,
    )
    .await;
    assert_eq!(antwort.status, StatusCode::OK);
    let challenge = antwort.json["publicKey"]["challenge"]
        .as_str()
        .unwrap()
        .to_string();
    (
        passkey,
        handle.as_bytes().to_vec(),
        challenge,
        cookie_paar(&antwort.cookies, "webauthn_disc"),
    )
}

#[tokio::test]
async fn discoverable_passkey_anmeldung_hinterlaesst_genau_einen_login_ok() {
    webauthn_aktivieren();
    let (app, pool) = setup_mit_pool().await;
    let (passkey, handle, challenge, cookie) =
        discoverable_zeremonie(&app, &pool, b"disc-erfolg").await;
    let id = benutzer_id(&pool, "admin").await;
    spur_leeren(&pool).await;

    let body = passkey.assertion(&challenge, &passkey.schluessel, Some(&handle));
    let antwort = sende(
        &app,
        "POST",
        "/api/auth/webauthn/discoverable/finish",
        Some(&cookie),
        Some(body),
    )
    .await;
    assert_eq!(antwort.status, StatusCode::OK, "{:?}", antwort.json);

    assert_eq!(spur(&pool).await, vec![erfolg("webauthn", "admin", id)]);
}

#[tokio::test]
async fn discoverable_passkey_mit_falscher_signatur_hinterlaesst_genau_einen_fehlschlag() {
    webauthn_aktivieren();
    let (app, pool) = setup_mit_pool().await;
    let (passkey, handle, challenge, cookie) =
        discoverable_zeremonie(&app, &pool, b"disc-falsch").await;
    spur_leeren(&pool).await;

    let fremd = TestPasskey::neu(b"fremd");
    let body = passkey.assertion(&challenge, &fremd.schluessel, Some(&handle));
    let antwort = sende(
        &app,
        "POST",
        "/api/auth/webauthn/discoverable/finish",
        Some(&cookie),
        Some(body),
    )
    .await;
    assert_eq!(antwort.status, StatusCode::UNAUTHORIZED);

    assert_eq!(spur(&pool).await, vec![fehlschlag("webauthn", None)]);
}

// ===== OIDC =====

const CLIENT_ID: &str = "lifeline-test";
const NONCE: &str = "nonce-fest";
/// Der Code, den der Mini-IdP gegen ein gültiges Token tauscht.
const GUTER_CODE: &str = "guter-code";
/// Dieser Code liefert ein korrekt signiertes Token mit FREMDER `nonce`, das der Server abweisen
/// muss. Jeden anderen Code weist schon der IdP ab.
const FREMDE_NONCE_CODE: &str = "fremde-nonce";

/// Basis-URL des Mini-IdP. Er läuft in einem eigenen Thread mit eigener Runtime, weil jeder
/// `#[tokio::test]` seine Runtime am Ende abbaut, der Discovery-Cache des Servers aber
/// prozessweit gilt.
static IDP: LazyLock<String> = LazyLock::new(|| {
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(async move {
                let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
                let basis = format!("http://{}", listener.local_addr().unwrap());
                tx.send(basis.clone()).unwrap();
                axum::serve(listener, mini_idp(basis)).await.unwrap();
            });
    });
    rx.recv().unwrap()
});

/// Discovery, JWKS und Token-Endpoint eines IdP, der `id_token`s mit einem frischen
/// RSA-Schlüssel signiert.
fn mini_idp(basis: String) -> axum::Router {
    use openidconnect::core::{
        CoreJsonWebKeySet, CoreJwsSigningAlgorithm, CoreProviderMetadata, CoreResponseType,
        CoreRsaPrivateSigningKey, CoreSubjectIdentifierType,
    };
    use openidconnect::{
        AuthUrl, EmptyAdditionalProviderMetadata, IssuerUrl, JsonWebKeyId, JsonWebKeySetUrl,
        PrivateSigningKey, ResponseTypes, TokenUrl,
    };

    let pem = openssl::rsa::Rsa::generate(2048)
        .unwrap()
        .private_key_to_pem()
        .unwrap();
    let schluessel = CoreRsaPrivateSigningKey::from_pem(
        std::str::from_utf8(&pem).unwrap(),
        Some(JsonWebKeyId::new("k1".to_string())),
    )
    .unwrap();
    let jwks = serde_json::to_value(CoreJsonWebKeySet::new(vec![
        schluessel.as_verification_key()
    ]))
    .unwrap();

    let issuer = IssuerUrl::new(basis.clone()).unwrap();
    let metadata = serde_json::to_value(
        CoreProviderMetadata::new(
            issuer.clone(),
            AuthUrl::new(format!("{basis}/authorize")).unwrap(),
            JsonWebKeySetUrl::new(format!("{basis}/jwks")).unwrap(),
            vec![ResponseTypes::new(vec![CoreResponseType::Code])],
            vec![CoreSubjectIdentifierType::Public],
            vec![CoreJwsSigningAlgorithm::RsaSsaPkcs1V15Sha256],
            EmptyAdditionalProviderMetadata {},
        )
        .set_token_endpoint(Some(TokenUrl::new(format!("{basis}/token")).unwrap())),
    )
    .unwrap();

    let idp = std::sync::Arc::new(MiniIdp { issuer, schluessel });
    axum::Router::new()
        .route(
            "/.well-known/openid-configuration",
            axum::routing::get(move || async move { axum::Json(metadata) }),
        )
        .route(
            "/jwks",
            axum::routing::get(move || async move { axum::Json(jwks) }),
        )
        .route("/token", axum::routing::post(token))
        .with_state(idp)
}

/// Zustand des Mini-IdP: Issuer und Signierschlüssel der `id_token`s.
struct MiniIdp {
    issuer: openidconnect::IssuerUrl,
    schluessel: openidconnect::core::CoreRsaPrivateSigningKey,
}

/// Token-Endpoint: tauscht [`GUTER_CODE`] und [`FREMDE_NONCE_CODE`], jeden anderen Code weist
/// er ab.
async fn token(
    axum::extract::State(idp): axum::extract::State<std::sync::Arc<MiniIdp>>,
    body: String,
) -> (StatusCode, axum::Json<serde_json::Value>) {
    use openidconnect::core::{CoreIdToken, CoreIdTokenClaims, CoreJwsSigningAlgorithm};
    use openidconnect::{
        Audience, EmptyAdditionalClaims, EndUserUsername, Nonce, StandardClaims, SubjectIdentifier,
    };

    let nonce = if body.split('&').any(|t| t == format!("code={GUTER_CODE}")) {
        NONCE
    } else if body
        .split('&')
        .any(|t| t == format!("code={FREMDE_NONCE_CODE}"))
    {
        "andere-nonce"
    } else {
        return (
            StatusCode::BAD_REQUEST,
            axum::Json(serde_json::json!({"error": "invalid_grant"})),
        );
    };
    let jetzt = chrono::Utc::now();
    let claims = CoreIdTokenClaims::new(
        idp.issuer.clone(),
        vec![Audience::new(CLIENT_ID.to_string())],
        jetzt + chrono::Duration::minutes(5),
        jetzt,
        StandardClaims::new(SubjectIdentifier::new("sub-1".to_string()))
            .set_preferred_username(Some(EndUserUsername::new("sso.nutzer".to_string()))),
        EmptyAdditionalClaims {},
    )
    .set_nonce(Some(Nonce::new(nonce.to_string())));
    let id_token = CoreIdToken::new(
        claims,
        &idp.schluessel,
        CoreJwsSigningAlgorithm::RsaSsaPkcs1V15Sha256,
        None,
        None,
    )
    .unwrap();
    (
        StatusCode::OK,
        axum::Json(serde_json::json!({
            "access_token": "at",
            "token_type": "bearer",
            "expires_in": 300,
            "id_token": id_token.to_string(),
        })),
    )
}

fn oidc_aktivieren() {
    lifeline_hub::auth::provider::registry::set_oidc_konfiguriert(true);
    lifeline_hub::auth::oidc::init_oidc_settings(lifeline_hub::auth::oidc::OidcSettings {
        issuer: Some(IDP.clone()),
        client_id: Some(CLIENT_ID.to_string()),
        client_secret: Some(lifeline_hub::config::GeheimesPasswort("geheim".to_string())),
        redirect_url: Some("http://localhost/api/auth/oidc/callback".to_string()),
    });
}

/// Ruft den Callback mit gültigem State und Binding-Cookie, aber dem gegebenen `code` auf.
async fn oidc_callback(app: &axum::Router, state_key: &str, code: &str) -> Antwort {
    lifeline_hub::auth::oidc::state::speichere(
        state_key.to_string(),
        lifeline_hub::auth::oidc::state::StateEintrag {
            nonce: NONCE.to_string(),
            pkce_verifier: "v".repeat(43),
            ziel_pfad: "/einsaetze".to_string(),
        },
    );
    sende(
        app,
        "GET",
        &format!("/api/auth/oidc/callback?code={code}&state={state_key}"),
        Some(&format!("oidc_state={state_key}")),
        None,
    )
    .await
}

#[tokio::test]
async fn oidc_anmeldung_hinterlaesst_genau_einen_login_ok() {
    oidc_aktivieren();
    let (app, pool) = setup_mit_pool().await;

    let antwort = oidc_callback(&app, "state-erfolg", GUTER_CODE).await;
    assert_eq!(antwort.location.as_deref(), Some("/einsaetze"));

    // Das Konto entsteht erst beim Callback (JIT-Provisioning).
    let id = benutzer_id(&pool, "sso.nutzer").await;
    assert_eq!(spur(&pool).await, vec![erfolg("oidc", "sso.nutzer", id)]);
}

#[tokio::test]
async fn ungueltiges_id_token_hinterlaesst_genau_einen_fehlschlag() {
    oidc_aktivieren();
    let (app, pool) = setup_mit_pool().await;

    let antwort = oidc_callback(&app, "state-fremde-nonce", FREMDE_NONCE_CODE).await;
    assert_eq!(antwort.location.as_deref(), Some("/login?fehler=oidc"));

    assert_eq!(spur(&pool).await, vec![fehlschlag("oidc", None)]);
}

#[tokio::test]
async fn gestoerter_oidc_token_tausch_hinterlaesst_keinen_eintrag() {
    oidc_aktivieren();
    let (app, pool) = setup_mit_pool().await;

    // Der IdP weist den Code ab: eine Störung am IdP, kein Fehlschlag des Anmeldenden.
    let antwort = oidc_callback(&app, "state-stoerung", "falscher-code").await;
    assert_eq!(antwort.location.as_deref(), Some("/login?fehler=oidc"));

    assert_eq!(spur(&pool).await, vec![]);
}

#[tokio::test]
async fn oidc_abbruch_beim_idp_hinterlaesst_genau_einen_fehlschlag() {
    oidc_aktivieren();
    let (app, pool) = setup_mit_pool().await;
    lifeline_hub::auth::oidc::state::speichere(
        "state-abbruch".to_string(),
        lifeline_hub::auth::oidc::state::StateEintrag {
            nonce: NONCE.to_string(),
            pkce_verifier: "v".repeat(43),
            ziel_pfad: "/einsaetze".to_string(),
        },
    );

    let antwort = sende(
        &app,
        "GET",
        "/api/auth/oidc/callback?error=access_denied&state=state-abbruch",
        Some("oidc_state=state-abbruch"),
        None,
    )
    .await;
    assert_eq!(antwort.location.as_deref(), Some("/login?fehler=oidc"));

    assert_eq!(spur(&pool).await, vec![fehlschlag("oidc", None)]);
}

#[tokio::test]
async fn oidc_callback_ohne_laufende_anmeldung_hinterlaesst_keinen_eintrag() {
    oidc_aktivieren();
    let (app, pool) = setup_mit_pool().await;

    // Auslösbar von jeder fremden Seite: Fehler-Callback, unbekannter State, falsches Cookie.
    for (uri, cookie) in [
        (
            "/api/auth/oidc/callback?error=access_denied&state=nie",
            None,
        ),
        (
            "/api/auth/oidc/callback?code=x&state=unbekannt",
            Some("oidc_state=unbekannt"),
        ),
        (
            "/api/auth/oidc/callback?code=x&state=a",
            Some("oidc_state=b"),
        ),
    ] {
        let antwort = sende(&app, "GET", uri, cookie, None).await;
        assert_eq!(
            antwort.location.as_deref(),
            Some("/login?fehler=oidc"),
            "{uri}"
        );
    }

    assert_eq!(spur(&pool).await, vec![]);
}

#[tokio::test]
async fn deaktiviertes_oidc_konto_hinterlaesst_einen_fehlschlag_mit_benutzer() {
    oidc_aktivieren();
    let (app, pool) = setup_mit_pool().await;
    let antwort = oidc_callback(&app, "state-vorher", GUTER_CODE).await;
    assert_eq!(antwort.location.as_deref(), Some("/einsaetze"));
    let id = benutzer_id(&pool, "sso.nutzer").await;
    sqlx::query("UPDATE benutzer SET aktiv = 0 WHERE id = ?")
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();
    spur_leeren(&pool).await;

    let antwort = oidc_callback(&app, "state-deaktiviert", GUTER_CODE).await;
    assert_eq!(antwort.location.as_deref(), Some("/login?fehler=oidc"));

    // Signatur und Identität sind geprüft; abgewiesen wird ein bekanntes Konto, und das nennt
    // die Spur.
    assert_eq!(
        spur(&pool).await,
        vec![fehlschlag("oidc", Some(("sso.nutzer", id)))]
    );
}
