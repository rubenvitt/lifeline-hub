//! Helfer-App (Spec `docs/superpowers/specs/2026-11-24-vakwvkpg-helfer-app-design.md`, ADR-0098):
//! Helfer-Einladung durch die Leitung.

use axum::http::StatusCode;
use lifeline_hub::error::AppError;
use lifeline_hub::helfer::einladung::einladung_einloesen;
use serde_json::{json, Value};

mod common;
use common::{
    anfrage, anfrage_json, benutzer_anlegen, einsatz_anlegen, login_cookie, rolle_setzen,
    setup_mit_pool,
};

// ---------- Helfer ----------

/// Schaltet „Ortung im Einsatz“ der Organisation ein (Org-Admin).
async fn ortung_einschalten(app: &axum::Router, admin: &str) {
    let (s, v) = anfrage_json(
        app,
        "PUT",
        "/api/org-settings",
        admin,
        Some(&json!({"ortung_im_einsatz": true})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
}

async fn einladen(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    body: Value,
) -> (StatusCode, Value) {
    anfrage_json(
        app,
        "POST",
        &format!("/api/incidents/{einsatz}/helpers/invitations"),
        cookie,
        Some(&body),
    )
    .await
}

async fn einloesen(pool: &sqlx::SqlitePool, code: &str) -> Result<(i64, i64, i64), AppError> {
    let mut conn = pool.acquire().await.unwrap();
    einladung_einloesen(&mut conn, code).await
}

// ---------- Einladung ----------

#[tokio::test]
async fn leitung_legt_helfer_einladung_an_und_neue_ersetzt_alte() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    ortung_einschalten(&app, &admin).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let (s, erste) = einladen(&app, &admin, einsatz, json!({})).await;
    assert_eq!(s, StatusCode::CREATED, "{erste}");
    let code1 = erste["code"].as_str().unwrap().to_string();
    assert_eq!(code1.len(), 8, "{erste}");
    assert!(erste["id"].is_i64(), "{erste}");
    assert!(erste["expires_at"].is_string(), "{erste}");
    // Vorgabe 4 h.
    let ab = chrono::NaiveDateTime::parse_from_str(
        erste["expires_at"].as_str().unwrap(),
        "%Y-%m-%d %H:%M:%S",
    )
    .unwrap();
    let minuten = (ab - chrono::Utc::now().naive_utc()).num_minutes();
    assert!((238..=240).contains(&minuten), "Vorgabe 240 min: {minuten}");

    // Mehrfach einlösbar, zählt hoch.
    let (eid, e_einsatz, org) = einloesen(&pool, &code1).await.expect("erste Einlösung");
    assert_eq!(eid, erste["id"].as_i64().unwrap());
    assert_eq!(e_einsatz, einsatz);
    assert_eq!(org, 1);
    einloesen(&pool, &code1).await.expect("zweite Einlösung");
    let n: i64 = sqlx::query_scalar("SELECT einloesungen FROM helfer_einladung WHERE id = ?")
        .bind(eid)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 2);

    // Übersicht zeigt die gültige Einladung ohne Code.
    let (s, uebersicht) = anfrage(
        &app,
        "GET",
        &format!("/api/incidents/{einsatz}/helpers"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{uebersicht}");
    assert_eq!(uebersicht["invitation"]["id"], erste["id"], "{uebersicht}");
    assert!(
        !uebersicht["invitation"]
            .as_object()
            .unwrap()
            .contains_key("code"),
        "kein Code in der Übersicht: {uebersicht}"
    );
    assert_eq!(uebersicht["helpers"], json!([]));

    // Eine neue ersetzt die alte.
    let (s, zweite) = einladen(&app, &admin, einsatz, json!({"valid_minutes": 60})).await;
    assert_eq!(s, StatusCode::CREATED, "{zweite}");
    let code2 = zweite["code"].as_str().unwrap().to_string();
    assert_ne!(code1, code2);
    assert!(
        matches!(einloesen(&pool, &code1).await, Err(AppError::Unauthorized)),
        "alte Einladung ist ersetzt"
    );
    einloesen(&pool, &code2).await.expect("neue Einladung gilt");

    // Widerruf: 204, danach 401 beim Einlösen und keine Einladung in der Übersicht.
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!(
            "/api/incidents/{einsatz}/helpers/invitations/{}/revoke",
            zweite["id"]
        ),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    assert!(matches!(
        einloesen(&pool, &code2).await,
        Err(AppError::Unauthorized)
    ));
    let (_, uebersicht) = anfrage(
        &app,
        "GET",
        &format!("/api/incidents/{einsatz}/helpers"),
        &admin,
        None,
    )
    .await;
    assert!(
        !uebersicht.as_object().unwrap().contains_key("invitation"),
        "{uebersicht}"
    );

    // Ein falscher Code ist 401.
    assert!(matches!(
        einloesen(&pool, "ZZZZZZZZ").await,
        Err(AppError::Unauthorized)
    ));
}

#[tokio::test]
async fn einladung_endet_mit_dem_einsatz() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    ortung_einschalten(&app, &admin).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (s, v) = einladen(&app, &admin, einsatz, json!({})).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    sqlx::query("UPDATE einsatz SET status = 'abgeschlossen' WHERE id = ?")
        .bind(einsatz)
        .execute(&pool)
        .await
        .unwrap();
    assert!(matches!(
        einloesen(&pool, v["code"].as_str().unwrap()).await,
        Err(AppError::Unauthorized)
    ));
}

#[tokio::test]
async fn ohne_ortung_der_org_keine_einladung() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (s, v) = einladen(&app, &admin, einsatz, json!({})).await;
    assert_eq!(s, StatusCode::FORBIDDEN, "{v}");
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM helfer_einladung")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 0);
}

#[tokio::test]
async fn fuehrungspersonal_darf_keine_einladung_anlegen() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    ortung_einschalten(&app, &admin).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let fp = benutzer_anlegen(&app, &admin, "fuehrung", "keine").await;
    rolle_setzen(&app, &admin, einsatz, fp, "fuehrungspersonal").await;
    let fp = login_cookie(&app, "fuehrung", "fuehrungpw1").await;

    let (s, _) = einladen(&app, &fp, einsatz, json!({})).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, _) = anfrage(
        &app,
        "GET",
        &format!("/api/incidents/{einsatz}/helpers"),
        &fp,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM helfer_einladung")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 0);
}

#[tokio::test]
async fn einladung_gilt_hoechstens_72_stunden() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    ortung_einschalten(&app, &admin).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let (s, v) = einladen(&app, &admin, einsatz, json!({"valid_minutes": 10000})).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    let (s, v) = einladen(&app, &admin, einsatz, json!({"valid_minutes": 0})).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM helfer_einladung")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 0);
    let (s, v) = einladen(&app, &admin, einsatz, json!({"valid_minutes": 4320})).await;
    assert_eq!(s, StatusCode::CREATED, "72 h genau: {v}");
}

#[tokio::test]
async fn fremde_einladung_ist_404_beim_widerruf() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    ortung_einschalten(&app, &admin).await;
    let a = einsatz_anlegen(&app, &admin).await;
    let b = einsatz_anlegen(&app, &admin).await;
    let (_, v) = einladen(&app, &admin, a, json!({})).await;
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/incidents/{b}/helpers/invitations/{}/revoke", v["id"]),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}
