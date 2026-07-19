//! Auth-Audit-Spur über den echten Router (LFH-249/F30).
//!
//! Die Unit-Tests in `auth::audit` prüfen Schreiben und Purge isoliert. Hier geht es um die
//! Frage, die im Betrieb zählt: hinterlässt ein Anmeldeversuch, der ganz normal über
//! `POST /api/auth/login` hereinkommt, tatsächlich eine Spur — und zwar auch (gerade!) der
//! gescheiterte?

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
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
