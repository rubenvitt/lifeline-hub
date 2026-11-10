//! Gemeinsame Helfer der Tests mit zwei gekoppelten Instanzen (LLH-1493): je Instanz eigene DB
//! und eigener HTTP-Server auf Loopback.

#![allow(dead_code)]

use crate::common;
use axum::http::StatusCode;
use lifeline_hub::auth::unterschrift::pruefen::test_authenticator::SoftwarePasskey;
use lifeline_hub::auth::unterschrift::repo as unterschrift;
use serde_json::{json, Value};

pub const RP: &str = "hub.example.org";
pub const ORIGIN: &str = "https://hub.example.org";

pub struct Instanz {
    pub app: axum::Router,
    pub pool: sqlx::SqlitePool,
    pub adresse: String,
    pub admin: String,
    pub _server: tokio::task::JoinHandle<()>,
}

pub async fn instanz() -> Instanz {
    let (app, pool) = common::setup_mit_pool().await;
    instanz_aus(app, pool).await
}

/// Eine Instanz aus einem fertigen Router (etwa mit eigenem Live-Verteiler).
pub async fn instanz_aus(app: axum::Router, pool: sqlx::SqlitePool) -> Instanz {
    lifeline_hub::auth::unterschrift::set_rp(RP.into(), ORIGIN.into());
    let admin = common::login_cookie(&app, "admin", "startpw12").await;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let adresse = format!("http://{}", listener.local_addr().unwrap());
    let router = app.clone();
    let server = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    Instanz {
        app,
        pool,
        adresse,
        admin,
        _server: server,
    }
}

pub async fn schluessel(i: &Instanz) {
    let p = SoftwarePasskey::new("a", [1u8; 32]);
    let mut conn = i.pool.acquire().await.unwrap();
    let oeff = p.oeffentlich();
    unterschrift::create_lokal(
        &mut conn,
        &unterschrift::NeuerSchluessel {
            org_id: 1,
            benutzer_id: 1,
            benutzer_name: "Admin",
            credential_id: &p.credential_id,
            schluessel: &oeff,
            rp_id: RP,
            origin: ORIGIN,
            bezeichnung: "Stick A",
        },
    )
    .await
    .unwrap();
}

pub async fn koppeln(hub: &Instanz, elw: &Instanz) {
    let (s, v) = common::anfrage(
        &hub.app,
        "POST",
        "/api/admin/instanz/codes",
        &hub.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let code = v["code"].as_str().unwrap();
    let (s, v) = common::anfrage_json(
        &elw.app,
        "POST",
        "/api/admin/instanz/einloesen",
        &elw.admin,
        Some(&json!({"adresse": hub.adresse, "code": code})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
}

pub async fn gekoppelt() -> (Instanz, Instanz) {
    let hub = instanz().await;
    let elw = instanz().await;
    schluessel(&hub).await;
    koppeln(&hub, &elw).await;
    (hub, elw)
}

pub async fn melden(elw: &Instanz) {
    sqlx::query("UPDATE instanz_kopplung SET naechste_meldung_at = NULL")
        .execute(&elw.pool)
        .await
        .unwrap();
    lifeline_hub::instanz::melden::run_durchlauf(&elw.pool)
        .await
        .unwrap();
}

pub async fn exec(pool: &sqlx::SqlitePool, sql: &str) {
    sqlx::query(sqlx::AssertSqlSafe(sql.to_string()))
        .execute(pool)
        .await
        .unwrap();
}

pub async fn eine<T>(pool: &sqlx::SqlitePool, sql: &str) -> T
where
    T: Send + Unpin + for<'r> sqlx::Decode<'r, sqlx::Sqlite> + sqlx::Type<sqlx::Sqlite>,
{
    sqlx::query_scalar(sqlx::AssertSqlSafe(sql.to_string()))
        .fetch_one(pool)
        .await
        .unwrap()
}

pub async fn kopplung_elw(elw: &Instanz) -> Value {
    let (s, v) = common::anfrage(&elw.app, "GET", "/api/admin/instanz", &elw.admin, None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    v["kopplungen"][0].clone()
}

pub async fn lokale_id(elw: &Instanz, tabelle: &str, spalte: &str, wert: &str) -> i64 {
    sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
        "SELECT id FROM {tabelle} WHERE {spalte} = ?"
    )))
    .bind(wert)
    .fetch_one(&elw.pool)
    .await
    .unwrap()
}

/// Legt ein Konto über die Benutzerverwaltung an (`common::benutzer_anlegen` kennt nur eine
/// Instanz je Testprozess).
pub async fn konto(i: &Instanz, name: &str) -> i64 {
    let (s, v) = common::anfrage_json(
        &i.app,
        "POST",
        "/api/benutzer",
        &i.admin,
        Some(&json!({"anzeigename": name, "benutzername": name,
                     "passwort": format!("{name}-pw-123"), "org_rolle": "keine"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    v["id"].as_i64().unwrap()
}
