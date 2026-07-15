use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use tower::ServiceExt;

mod common;
use common::{anfrage, benutzer_anlegen, login_cookie, setup, setup_mit_pool};

#[tokio::test]
async fn liste_ohne_admin_session_ist_401() {
    let app = setup().await;
    let resp = app
        .oneshot(
            Request::builder()
                .uri("/api/benutzer")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn nicht_admin_bekommt_403_auf_benutzerliste() {
    let app = setup().await;
    let admin_cookie = login_cookie(&app, "admin", "startpw12").await;

    // Admin legt einen normalen Benutzer an.
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/benutzer")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, admin_cookie)
                .body(Body::from(
                    r#"{"anzeigename":"Erika","benutzername":"erika","passwort":"erikapw1"}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);

    // Dieser meldet sich an und versucht die Liste zu lesen → 403.
    let erika_cookie = login_cookie(&app, "erika", "erikapw1").await;
    let resp = app
        .oneshot(
            Request::builder()
                .uri("/api/benutzer")
                .header(header::COOKIE, erika_cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn admin_legt_benutzer_an_und_listet() {
    let app = setup().await;
    let admin_cookie = login_cookie(&app, "admin", "startpw12").await;

    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/benutzer")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, admin_cookie.clone())
                .body(Body::from(
                    r#"{"anzeigename":"Erika Muster","benutzername":"erika","passwort":"erikapw1"}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);

    let resp = app
        .oneshot(
            Request::builder()
                .uri("/api/benutzer")
                .header(header::COOKIE, admin_cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    let liste = json.as_array().unwrap();
    assert_eq!(liste.len(), 2); // admin + erika
}

#[tokio::test]
async fn admin_benutzerliste_enthaelt_totp_aktiviert() {
    // MFA-Status in der Admin-Benutzerliste (LFH-43, Increment 5, Task 6).
    let app = setup().await;
    let admin_cookie = login_cookie(&app, "admin", "startpw12").await;

    let (status, json) = anfrage(&app, "GET", "/api/benutzer", &admin_cookie, None).await;
    assert_eq!(status, StatusCode::OK);
    let liste = json.as_array().unwrap();
    assert_eq!(
        liste[0]["totp_aktiviert"], false,
        "frischer Admin ohne Enrollment: totp_aktiviert=false erwartet: {liste:?}"
    );
}

#[tokio::test]
async fn doppelter_benutzername_ist_409() {
    let app = setup().await;
    let admin_cookie = login_cookie(&app, "admin", "startpw12").await;

    let neu = r#"{"anzeigename":"Admin Zwei","benutzername":"admin","passwort":"adminpw2"}"#;
    let resp = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/benutzer")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, admin_cookie)
                .body(Body::from(neu))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::CONFLICT);
}

#[tokio::test]
async fn zu_kurzes_passwort_ist_400() {
    let app = setup().await;
    let admin_cookie = login_cookie(&app, "admin", "startpw12").await;

    let resp = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/benutzer")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, admin_cookie)
                .body(Body::from(
                    r#"{"anzeigename":"Kurz","benutzername":"kurz","passwort":"123"}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn letzter_admin_kann_nicht_deaktiviert_werden() {
    let app = setup().await;
    let admin_cookie = login_cookie(&app, "admin", "startpw12").await;

    // admin hat id=1 (erster und einziger Benutzer nach Bootstrap).
    let resp = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/benutzer/1/deaktivieren")
                .header(header::COOKIE, admin_cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::CONFLICT);
}

#[tokio::test]
async fn deaktivierter_benutzer_kann_sich_nicht_mehr_anmelden() {
    let app = setup().await;
    let admin_cookie = login_cookie(&app, "admin", "startpw12").await;

    // Zweiten Benutzer anlegen (bekommt id=2).
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/benutzer")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, admin_cookie.clone())
                .body(Body::from(
                    r#"{"anzeigename":"Erika","benutzername":"erika","passwort":"erikapw1"}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);

    // Deaktivieren.
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/benutzer/2/deaktivieren")
                .header(header::COOKIE, admin_cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // Login schlägt nun fehl (aktiv = 0).
    let body = r#"{"benutzername":"erika","passwort":"erikapw1"}"#;
    let resp = app
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
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn admin_legt_fuehrungskraft_an_und_org_rolle_erscheint() {
    let app = setup().await;
    let admin_cookie = login_cookie(&app, "admin", "startpw12").await;

    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/benutzer")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, admin_cookie)
                .body(Body::from(
                    r#"{"anzeigename":"Frieda Führung","benutzername":"frieda","passwort":"friedapw1","org_rolle":"fuehrungskraft"}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);

    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["org_rolle"], "fuehrungskraft");
}

#[tokio::test]
async fn ungueltige_org_rolle_ist_400() {
    let app = setup().await;
    let admin_cookie = login_cookie(&app, "admin", "startpw12").await;

    let resp = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/benutzer")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, admin_cookie)
                .body(Body::from(
                    r#"{"anzeigename":"X","benutzername":"x","passwort":"xpasswort1","org_rolle":"chef"}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

// ===== Admin-TOTP-Reset: POST /api/benutzer/{id}/totp/reset (LFH-43, Increment 5, Task 6) =====

/// Aktiviert TOTP für den durch `cookie` authentifizierten Nutzer über den echten Enroll-Flow
/// (`/api/auth/totp/enroll/start` + `/finish`, LFH-43 Task 4) — funktioniert für JEDEN
/// angemeldeten Nutzer (nicht nur Admins), da beide Endpunkte `CurrentUser`-gegated sind.
/// Liefert die zehn Klartext-Recovery-Codes.
async fn totp_aktivieren(app: &axum::Router, cookie: &str) -> Vec<String> {
    let (status, json) = anfrage(app, "POST", "/api/auth/totp/enroll/start", cookie, None).await;
    assert_eq!(status, StatusCode::OK);
    let secret = json["secret_base32"].as_str().unwrap().to_string();

    let jetzt = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let code = lifeline_hub::auth::totp::generiere_code(&secret, jetzt)
        .expect("Code-Erzeugung aus dem gerade zurückgegebenen Secret darf nicht scheitern");

    let (status, json) = anfrage(
        app,
        "POST",
        "/api/auth/totp/enroll/finish",
        cookie,
        Some(&format!(r#"{{"code":"{code}"}}"#)),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    json["recovery_codes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap().to_string())
        .collect()
}

#[tokio::test]
async fn admin_totp_reset_loescht_secret_aktiviert_recovery_codes_und_sessions() {
    let (app, pool) = setup_mit_pool().await;
    let admin_cookie = login_cookie(&app, "admin", "startpw12").await;
    let erika_id = benutzer_anlegen(&app, &admin_cookie, "erika", "keine").await;

    // Erika aktiviert TOTP für sich selbst und meldet sich an — eine laufende Session UND ein
    // aktiver zweiter Faktor sind die Ausgangslage vor dem Admin-Reset.
    let erika_cookie = login_cookie(&app, "erika", "erikapw1").await;
    let recovery_codes = totp_aktivieren(&app, &erika_cookie).await;
    assert_eq!(recovery_codes.len(), 10);

    let (aktiviert_vor, secret_vor): (i64, Option<String>) =
        sqlx::query_as("SELECT totp_aktiviert, totp_secret FROM benutzer WHERE id = ?")
            .bind(erika_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(aktiviert_vor, 1, "Vorbedingung: TOTP muss aktiv sein");
    assert!(
        secret_vor.is_some(),
        "Vorbedingung: Secret muss gesetzt sein"
    );

    let recovery_anzahl_vor: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM totp_recovery_code WHERE benutzer_id = ?")
            .bind(erika_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(recovery_anzahl_vor, 10);

    let sessions_vor: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM session WHERE benutzer_id = ?")
            .bind(erika_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(
        sessions_vor >= 1,
        "Vorbedingung: Erika muss mind. eine laufende Session haben"
    );

    // Admin-Reset.
    let (status, json) = anfrage(
        &app,
        "POST",
        &format!("/api/benutzer/{erika_id}/totp/reset"),
        &admin_cookie,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["totp_aktiviert"], false);

    let (aktiviert_nach, secret_nach): (i64, Option<String>) =
        sqlx::query_as("SELECT totp_aktiviert, totp_secret FROM benutzer WHERE id = ?")
            .bind(erika_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(aktiviert_nach, 0, "Reset muss totp_aktiviert auf 0 setzen");
    assert!(
        secret_nach.is_none(),
        "Reset muss totp_secret auf NULL setzen"
    );

    let recovery_anzahl_nach: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM totp_recovery_code WHERE benutzer_id = ?")
            .bind(erika_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        recovery_anzahl_nach, 0,
        "Reset muss alle Recovery-Codes des Nutzers löschen (keine stale Codes)"
    );

    let sessions_nach: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM session WHERE benutzer_id = ?")
            .bind(erika_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        sessions_nach, 0,
        "Reset muss die Sessions des Nutzers invalidieren"
    );
}

#[tokio::test]
async fn admin_totp_reset_ohne_session_ist_401_und_ohne_admin_ist_403() {
    let app = setup().await;
    let admin_cookie = login_cookie(&app, "admin", "startpw12").await;
    let erika_id = benutzer_anlegen(&app, &admin_cookie, "erika", "keine").await;

    // Ganz ohne Session.
    let (status_ohne_session, _) = anfrage(
        &app,
        "POST",
        &format!("/api/benutzer/{erika_id}/totp/reset"),
        "",
        None,
    )
    .await;
    assert_eq!(status_ohne_session, StatusCode::UNAUTHORIZED);

    // Mit einer Session, aber ohne Admin-Rolle (Erika versucht, sich selbst zurückzusetzen).
    let erika_cookie = login_cookie(&app, "erika", "erikapw1").await;
    let (status_nicht_admin, _) = anfrage(
        &app,
        "POST",
        &format!("/api/benutzer/{erika_id}/totp/reset"),
        &erika_cookie,
        None,
    )
    .await;
    assert_eq!(status_nicht_admin, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn admin_totp_reset_unbekannter_benutzer_ist_404() {
    let app = setup().await;
    let admin_cookie = login_cookie(&app, "admin", "startpw12").await;

    let (status, _) = anfrage(
        &app,
        "POST",
        "/api/benutzer/999999/totp/reset",
        &admin_cookie,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}
