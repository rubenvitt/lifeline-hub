//! TOTP-Einrichtung nur mit dem aktuellen Passwort (LFH-1013): `POST /api/auth/totp/enroll/start`.
//!
//! Ohne diese Prüfung richtete jemand mit einer fremden Sitzung (unbeaufsichtigter Fükw,
//! entwendetes Tablet) auf einem Konto ohne Zweitfaktor seinen eigenen Authenticator ein und
//! sperrte den Eigentümer aus. Gepinnt ist: ohne gültiges Passwort entsteht kein Secret.

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use tower::ServiceExt;

mod common;
use common::{anfrage, benutzer_anlegen, login_cookie, setup_mit_pool};

const PFAD: &str = "/api/auth/totp/enroll/start";

fn body(passwort: &str) -> String {
    format!(r#"{{"passwort":"{passwort}"}}"#)
}

/// Legt eine Nicht-Admin-Benutzerin an und meldet sie an. `benutzer_anlegen` vergibt das
/// Passwort `<name>pw1`.
async fn nutzerin(app: &axum::Router) -> String {
    let admin = login_cookie(app, "admin", "startpw12").await;
    benutzer_anlegen(app, &admin, "nutzerin", "keine").await;
    login_cookie(app, "nutzerin", "nutzerinpw1").await
}

async fn secret_von(pool: &sqlx::SqlitePool, benutzername: &str) -> Option<String> {
    sqlx::query_scalar("SELECT totp_secret FROM benutzer WHERE benutzername = ?")
        .bind(benutzername)
        .fetch_one(pool)
        .await
        .unwrap()
}

/// `enroll/start` von der Quelle `ip`.
async fn start_von(app: &axum::Router, ip: &str, cookie: &str, passwort: &str) -> StatusCode {
    let mut req = Request::builder()
        .method("POST")
        .uri(PFAD)
        .header(header::COOKIE, cookie)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body(passwort)))
        .unwrap();
    let peer: std::net::SocketAddr = format!("{ip}:40000").parse().unwrap();
    req.extensions_mut()
        .insert(axum::extract::ConnectInfo(peer));
    app.clone().oneshot(req).await.unwrap().status()
}

#[tokio::test]
async fn mit_korrektem_passwort_liefert_start_das_secret() {
    let (app, pool) = setup_mit_pool().await;
    let cookie = nutzerin(&app).await;

    let (status, json) = anfrage(&app, "POST", PFAD, &cookie, Some(&body("nutzerinpw1"))).await;
    assert_eq!(status, StatusCode::OK);
    let secret = json["secret_base32"]
        .as_str()
        .expect("secret_base32 erwartet");
    assert_eq!(secret_von(&pool, "nutzerin").await.as_deref(), Some(secret));
}

#[tokio::test]
async fn ohne_body_ist_400_und_speichert_kein_secret() {
    let (app, pool) = setup_mit_pool().await;
    let cookie = nutzerin(&app).await;

    let (status, _) = anfrage(&app, "POST", PFAD, &cookie, None).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(secret_von(&pool, "nutzerin").await, None);
}

#[tokio::test]
async fn leeres_passwort_ist_400_und_speichert_kein_secret() {
    let (app, pool) = setup_mit_pool().await;
    let cookie = nutzerin(&app).await;

    let (status, _) = anfrage(&app, "POST", PFAD, &cookie, Some(&body(""))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(secret_von(&pool, "nutzerin").await, None);
}

/// 422, nicht 401: die Sitzung ist gültig, ein 401 ließe die Sitzungswache des Frontends abmelden.
#[tokio::test]
async fn falsches_passwort_ist_422_und_speichert_kein_secret() {
    let (app, pool) = setup_mit_pool().await;
    let cookie = nutzerin(&app).await;

    let (status, _) = anfrage(&app, "POST", PFAD, &cookie, Some(&body("falsch123"))).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(secret_von(&pool, "nutzerin").await, None);
}

/// Ein falsches Passwort zählt in die Sperre je Quelle, sonst wäre `enroll/start` ein
/// ungebremster Rateweg für jeden, der ein Cookie hat.
#[tokio::test]
async fn falsche_passwoerter_sperren_die_quelle() {
    let (app, pool) = setup_mit_pool().await;
    let cookie = nutzerin(&app).await;
    // Eigene Adresse je Test: die Sperre je Quelle ist prozessweit.
    let quelle = "198.51.100.131";

    for i in 0..lifeline_hub::auth::rate_limit::MAX_FEHLVERSUCHE {
        let status = start_von(&app, quelle, &cookie, "falsch123").await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "Versuch {i}");
    }
    let status = start_von(&app, quelle, &cookie, "nutzerinpw1").await;
    assert_eq!(
        status,
        StatusCode::TOO_MANY_REQUESTS,
        "die gesperrte Quelle kommt auch mit dem richtigen Passwort nicht durch"
    );
    assert_eq!(secret_von(&pool, "nutzerin").await, None);
}

/// Ein SSO-only-Konto hat kein lokales Passwort und kann keines nennen. TOTP schützt nur den
/// Passwort-Login; dort einzurichten hätte keine Wirkung.
#[tokio::test]
async fn sso_only_konto_kann_kein_totp_einrichten() {
    let (app, pool) = setup_mit_pool().await;
    let cookie = nutzerin(&app).await;
    sqlx::query("UPDATE benutzer SET passwort_hash = ? WHERE benutzername = 'nutzerin'")
        .bind(lifeline_hub::auth::PASSWORT_HASH_SSO_ONLY)
        .execute(&pool)
        .await
        .unwrap();

    for passwort in [
        "irgendwas1",
        "nutzerinpw1",
        lifeline_hub::auth::PASSWORT_HASH_SSO_ONLY,
    ] {
        let (status, _) = anfrage(&app, "POST", PFAD, &cookie, Some(&body(passwort))).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{passwort}");
    }
    assert_eq!(secret_von(&pool, "nutzerin").await, None);
}

#[tokio::test]
async fn deaktivierter_passwort_provider_ist_403_und_speichert_kein_secret() {
    let (app, pool) = setup_mit_pool().await;
    let cookie = nutzerin(&app).await;
    sqlx::query(
        "INSERT INTO auth_provider (id, aktiviert) VALUES ('passwort', 0) \
         ON CONFLICT(id) DO UPDATE SET aktiviert = 0",
    )
    .execute(&pool)
    .await
    .unwrap();

    let (status, _) = anfrage(&app, "POST", PFAD, &cookie, Some(&body("nutzerinpw1"))).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(secret_von(&pool, "nutzerin").await, None);
}
