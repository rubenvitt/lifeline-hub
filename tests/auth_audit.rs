//! Auth-Audit-Spur über den echten Router (LFH-249/F30).
//!
//! Die Unit-Tests in `auth::audit` prüfen Schreiben und Purge isoliert. Hier geht es um die
//! Frage, die im Betrieb zählt: hinterlässt ein Anmeldeversuch, der ganz normal über
//! `POST /api/auth/login` hereinkommt, tatsächlich eine Spur — und zwar auch (gerade!) der
//! gescheiterte?

use axum::body::Body;
use axum::extract::ConnectInfo;
use axum::http::{header, Request, StatusCode};
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

// --- Passwortwechsel (LFH-827) ---
//
// `POST /api/auth/passwort` schrieb bis LFH-827 nur `tracing`. Bei einem Vorfall lautet die Frage
// aber „wann hat wer das Passwort geändert, und von welcher IP?“ — die beantwortet nur die
// Tabelle.

/// Wechselt das Passwort der angemeldeten Sitzung von `gegenstelle` aus und liefert den Status.
/// Die Gegenstelle setzt `ConnectInfo` wie der echte Server, damit die IP in der Spur ankommt;
/// jeder Test nimmt eine eigene, weil die Anmelde-Bremse prozessweit je IP zählt.
async fn passwort_wechseln(
    app: &axum::Router,
    cookie: &str,
    gegenstelle: &str,
    alt: &str,
    neu: &str,
) -> StatusCode {
    let body = format!(r#"{{"altes_passwort":"{alt}","neues_passwort":"{neu}"}}"#);
    let mut req = Request::builder()
        .method("POST")
        .uri("/api/auth/passwort")
        .header(header::COOKIE, cookie)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body))
        .unwrap();
    let peer: SocketAddr = gegenstelle.parse().unwrap();
    req.extensions_mut().insert(ConnectInfo(peer));
    app.clone().oneshot(req).await.unwrap().status()
}

/// Ereignis, Benutzername, Benutzer-id, IP und Anmeldeweg der Passwort-Ereignisse.
type PasswortZeile = (String, Option<String>, Option<i64>, Option<String>, String);

async fn passwort_spur(pool: &sqlx::SqlitePool) -> Vec<PasswortZeile> {
    sqlx::query_as(
        "SELECT ereignis, benutzername, benutzer_id, peer_ip, provider FROM auth_audit \
         WHERE ereignis LIKE 'passwort%' ORDER BY id",
    )
    .fetch_all(pool)
    .await
    .unwrap()
}

async fn admin_id(pool: &sqlx::SqlitePool) -> i64 {
    sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername = 'admin'")
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn erfolgreicher_passwortwechsel_hinterlaesst_eine_spur() {
    let (app, pool) = setup_mit_pool().await;
    let cookie = common::login_cookie(&app, "admin", "startpw12").await;

    let status = passwort_wechseln(
        &app,
        &cookie,
        "203.0.113.21:50000",
        "startpw12",
        "ganzneu1234",
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    assert_eq!(
        passwort_spur(&pool).await,
        vec![(
            "passwort_geaendert".to_string(),
            Some("admin".to_string()),
            Some(admin_id(&pool).await),
            Some("203.0.113.21".to_string()),
            "passwort".to_string(),
        )],
        "ein Passwortwechsel muss rückwirkend nachweisbar sein"
    );
}

#[tokio::test]
async fn abgewiesener_passwortwechsel_hinterlaesst_eine_spur() {
    let (app, pool) = setup_mit_pool().await;
    let cookie = common::login_cookie(&app, "admin", "startpw12").await;

    let status = passwort_wechseln(
        &app,
        &cookie,
        "203.0.113.22:50000",
        "daneben123",
        "ganzneu1234",
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    assert_eq!(
        passwort_spur(&pool).await,
        vec![(
            "passwort_wechsel_abgewiesen".to_string(),
            Some("admin".to_string()),
            Some(admin_id(&pool).await),
            Some("203.0.113.22".to_string()),
            "passwort".to_string(),
        )],
        "ein Wechselversuch mit falschem Alt-Passwort ist das Muster einer übernommenen Sitzung"
    );
}

/// Was schon an der Form scheitert (zu kurzes neues Passwort), hat das Alt-Passwort nie geprüft
/// und ist kein Wechselversuch im Sinne der Spur.
#[tokio::test]
async fn formfehler_beim_passwortwechsel_hinterlaesst_keine_spur() {
    let (app, pool) = setup_mit_pool().await;
    let cookie = common::login_cookie(&app, "admin", "startpw12").await;

    let status =
        passwort_wechseln(&app, &cookie, "203.0.113.23:50000", "startpw12", "kurz123").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    assert!(passwort_spur(&pool).await.is_empty());
}
