//! Anmeldung der macOS-Hülle im Systembrowser (LFH-818): Einmalcode ausstellen und einlösen.
//!
//! Spec: `openspec/changes/lfh-818-anmeldung-im-systembrowser/specs/anmeldung-systembrowser/`.
//! Der Browser (Cookie A) stellt einen an die `challenge` gebundenen Code aus, die Hülle löst ihn
//! mit dem `verifier` in einem anderen Cookie-Speicher ein.

use axum::body::{to_bytes, Body};
use axum::extract::ConnectInfo;
use axum::http::{header, Request, StatusCode};
use lifeline_hub::auth::huelle::state::{speichere_mit_ablauf, CodeEintrag};
use serde_json::{json, Value};
use std::net::SocketAddr;
use std::time::Instant;
use tower::ServiceExt;

mod common;
use common::{anfrage, benutzer_anlegen, login_cookie, setup_mit_pool};

// RFC 7636, Anhang B.
const VERIFIER: &str = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CHALLENGE: &str = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const FREMDER_VERIFIER: &str = "eBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";

struct Antwort {
    status: StatusCode,
    set_cookie: Option<String>,
    body: Value,
}

/// POST ohne Hilfs-Header, optional mit Cookie und Absenderadresse (für das Rate-Limit).
async fn post(
    app: &axum::Router,
    uri: &str,
    cookie: Option<&str>,
    body: &Value,
    peer: Option<SocketAddr>,
) -> Antwort {
    let mut req = Request::builder()
        .method("POST")
        .uri(uri)
        .header(header::CONTENT_TYPE, "application/json");
    if let Some(c) = cookie {
        req = req.header(header::COOKIE, c);
    }
    let mut req = req.body(Body::from(body.to_string())).unwrap();
    if let Some(p) = peer {
        req.extensions_mut().insert(ConnectInfo(p));
    }
    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let set_cookie = resp
        .headers()
        .get(header::SET_COOKIE)
        .map(|v| v.to_str().unwrap().split(';').next().unwrap().to_string());
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    Antwort {
        status,
        set_cookie,
        body: serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    }
}

async fn code_ausstellen(app: &axum::Router, cookie: &str, challenge: &str) -> String {
    let a = post(
        app,
        "/api/auth/app-code",
        Some(cookie),
        &json!({ "challenge": challenge }),
        None,
    )
    .await;
    assert_eq!(a.status, StatusCode::OK, "{:?}", a.body);
    a.body["code"].as_str().unwrap().to_string()
}

async fn einloesen(app: &axum::Router, code: &str, verifier: &str) -> Antwort {
    post(
        app,
        "/api/auth/app-code/einloesen",
        None,
        &json!({ "code": code, "verifier": verifier }),
        None,
    )
    .await
}

async fn me_status(app: &axum::Router, cookie: &str) -> (StatusCode, Value) {
    anfrage(app, "GET", "/api/auth/me", cookie, None).await
}

async fn audit(pool: &sqlx::SqlitePool) -> Vec<(String, Option<i64>, String)> {
    sqlx::query_as("SELECT ereignis, benutzer_id, provider FROM auth_audit ORDER BY id")
        .fetch_all(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn ausstellen_ohne_sitzung_ist_401() {
    let (app, _pool) = setup_mit_pool().await;
    let a = post(
        &app,
        "/api/auth/app-code",
        None,
        &json!({ "challenge": CHALLENGE }),
        None,
    )
    .await;
    assert_eq!(a.status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn challenge_in_falscher_form_ist_400() {
    let (app, _pool) = setup_mit_pool().await;
    let browser = login_cookie(&app, "admin", "startpw12").await;
    for falsch in [
        "",
        "kurz",
        &CHALLENGE[..42],
        "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw+cM",
    ] {
        let a = post(
            &app,
            "/api/auth/app-code",
            Some(&browser),
            &json!({ "challenge": falsch }),
            None,
        )
        .await;
        assert_eq!(a.status, StatusCode::BAD_REQUEST, "challenge {falsch:?}");
    }
}

#[tokio::test]
async fn passender_verifier_ergibt_eigene_sitzung_und_browsersitzung_bleibt() {
    let (app, pool) = setup_mit_pool().await;
    let browser = login_cookie(&app, "admin", "startpw12").await;
    let code = code_ausstellen(&app, &browser, CHALLENGE).await;
    assert_eq!(code.len(), 64);

    let a = einloesen(&app, &code, VERIFIER).await;
    assert_eq!(a.status, StatusCode::NO_CONTENT);
    let app_cookie = a.set_cookie.expect("Sitzungs-Cookie");
    assert!(app_cookie.starts_with("lifeline_sid="));
    assert_ne!(app_cookie, browser, "die App bekommt eine eigene Sitzung");

    let (status, me) = me_status(&app, &app_cookie).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(me["benutzername"], "admin");
    assert_eq!(me_status(&app, &browser).await.0, StatusCode::OK);

    let admin_id: i64 = sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername = 'admin'")
        .fetch_one(&pool)
        .await
        .unwrap();
    let spur = audit(&pool).await;
    assert_eq!(
        spur.last().unwrap(),
        &(
            "login_ok".to_string(),
            Some(admin_id),
            "systembrowser".to_string()
        )
    );
}

#[tokio::test]
async fn code_gilt_nur_einmal() {
    let (app, _pool) = setup_mit_pool().await;
    let browser = login_cookie(&app, "admin", "startpw12").await;
    let code = code_ausstellen(&app, &browser, CHALLENGE).await;

    assert_eq!(
        einloesen(&app, &code, VERIFIER).await.status,
        StatusCode::NO_CONTENT
    );
    let zweites = einloesen(&app, &code, VERIFIER).await;
    assert_eq!(zweites.status, StatusCode::UNAUTHORIZED);
    assert!(zweites.set_cookie.is_none());
}

#[tokio::test]
async fn fremder_verifier_verbraucht_den_code() {
    let (app, pool) = setup_mit_pool().await;
    let browser = login_cookie(&app, "admin", "startpw12").await;
    let code = code_ausstellen(&app, &browser, CHALLENGE).await;

    let fremd = einloesen(&app, &code, FREMDER_VERIFIER).await;
    assert_eq!(fremd.status, StatusCode::UNAUTHORIZED);
    assert!(fremd.set_cookie.is_none());
    // Auch der richtige verifier hilft danach nicht mehr.
    assert_eq!(
        einloesen(&app, &code, VERIFIER).await.status,
        StatusCode::UNAUTHORIZED
    );

    let spur = audit(&pool).await;
    assert!(spur
        .iter()
        .any(|(e, _, p)| e == "login_fehlgeschlagen" && p == "systembrowser"));
}

#[tokio::test]
async fn abgelaufener_code_ist_401() {
    let (app, pool) = setup_mit_pool().await;
    let admin_id: i64 = sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername = 'admin'")
        .fetch_one(&pool)
        .await
        .unwrap();
    let code = "a".repeat(64);
    speichere_mit_ablauf(
        code.clone(),
        CodeEintrag {
            benutzer_id: admin_id,
            challenge: CHALLENGE.to_string(),
        },
        Instant::now(),
    );
    assert_eq!(
        einloesen(&app, &code, VERIFIER).await.status,
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn deaktiviertes_konto_ist_401() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "gerda", "keine").await;
    let gerda = login_cookie(&app, "gerda", "gerdapw1").await;
    let code = code_ausstellen(&app, &gerda, CHALLENGE).await;
    sqlx::query("UPDATE benutzer SET aktiv = 0 WHERE benutzername = 'gerda'")
        .execute(&pool)
        .await
        .unwrap();

    let a = einloesen(&app, &code, VERIFIER).await;
    assert_eq!(a.status, StatusCode::UNAUTHORIZED);
    assert!(a.set_cookie.is_none());
}

#[tokio::test]
async fn unbekannt_und_falsch_gebunden_sind_nicht_unterscheidbar() {
    let (app, _pool) = setup_mit_pool().await;
    let browser = login_cookie(&app, "admin", "startpw12").await;
    let code = code_ausstellen(&app, &browser, CHALLENGE).await;

    let unbekannt = einloesen(&app, &"b".repeat(64), VERIFIER).await;
    let falsch = einloesen(&app, &code, FREMDER_VERIFIER).await;
    assert_eq!(unbekannt.status, StatusCode::UNAUTHORIZED);
    assert_eq!(unbekannt.status, falsch.status);
    assert_eq!(unbekannt.body, falsch.body);
}

#[tokio::test]
async fn einloesen_in_falscher_form_ist_400() {
    let (app, _pool) = setup_mit_pool().await;
    let code = "c".repeat(64);
    for body in [
        json!({ "code": code, "verifier": "" }),
        json!({ "code": code }),
        json!({ "code": code, "verifier": "a".repeat(42) }),
        json!({ "code": code, "verifier": 5 }),
        json!({ "code": "", "verifier": VERIFIER }),
        json!({ "code": "Z".repeat(64), "verifier": VERIFIER }),
    ] {
        let a = post(&app, "/api/auth/app-code/einloesen", None, &body, None).await;
        assert_eq!(a.status, StatusCode::BAD_REQUEST, "body {body}");
    }
}

#[tokio::test]
async fn formfehler_verbraucht_den_code_nicht() {
    let (app, _pool) = setup_mit_pool().await;
    let browser = login_cookie(&app, "admin", "startpw12").await;
    let code = code_ausstellen(&app, &browser, CHALLENGE).await;

    let a = einloesen(&app, &code, "zu-kurz").await;
    assert_eq!(a.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        einloesen(&app, &code, VERIFIER).await.status,
        StatusCode::NO_CONTENT
    );
}

#[tokio::test]
async fn alte_sitzung_im_einloesenden_speicher_wird_geloescht() {
    let (app, _pool) = setup_mit_pool().await;
    let browser = login_cookie(&app, "admin", "startpw12").await;
    // Eine übrig gebliebene Sitzung im Webview der Hülle.
    let alt = login_cookie(&app, "admin", "startpw12").await;
    let code = code_ausstellen(&app, &browser, CHALLENGE).await;

    let a = post(
        &app,
        "/api/auth/app-code/einloesen",
        Some(&alt),
        &json!({ "code": code, "verifier": VERIFIER }),
        None,
    )
    .await;
    assert_eq!(a.status, StatusCode::NO_CONTENT);
    assert_eq!(me_status(&app, &alt).await.0, StatusCode::UNAUTHORIZED);
    assert_eq!(me_status(&app, &browser).await.0, StatusCode::OK);
}

#[tokio::test]
async fn gesperrte_adresse_bekommt_429_nach_fehlversuchen() {
    let (app, _pool) = setup_mit_pool().await;
    // Eigene Adresse, damit parallele Tests die globale Sperre nicht teilen.
    let peer: SocketAddr = "203.0.113.81:40000".parse().unwrap();
    for i in 0..10 {
        let a = post(
            &app,
            "/api/auth/app-code/einloesen",
            None,
            &json!({ "code": format!("{i:064x}"), "verifier": VERIFIER }),
            Some(peer),
        )
        .await;
        assert_eq!(a.status, StatusCode::UNAUTHORIZED, "Versuch {i}");
    }
    let a = post(
        &app,
        "/api/auth/app-code/einloesen",
        None,
        &json!({ "code": "d".repeat(64), "verifier": VERIFIER }),
        Some(peer),
    )
    .await;
    assert_eq!(a.status, StatusCode::TOO_MANY_REQUESTS);
}
