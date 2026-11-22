use axum::{
    body::Body,
    extract::ConnectInfo,
    http::{header, Request, StatusCode},
    Router,
};
use http_body_util::BodyExt;
mod gemeinsam;
use push_relais::{
    api::{router, RelaisState},
    speicher::{self, Pruefung},
};
use sqlx::SqlitePool;
use std::net::SocketAddr;
use tower::ServiceExt;

async fn aufbau() -> (Router, SqlitePool) {
    let pool = speicher::oeffnen(":memory:").await.unwrap();
    let app = router(RelaisState::neu(
        pool.clone(),
        10,
        false,
        gemeinsam::apns_client("http://127.0.0.1:9"),
        600,
    ));
    (app, pool)
}

fn registrierung(ip: &str) -> Request<Body> {
    let mut req = Request::post("/v1/server")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(r#"{ "version": "1.0.0" }"#))
        .unwrap();
    let adresse: SocketAddr = format!("{ip}:4000").parse().unwrap();
    req.extensions_mut().insert(ConnectInfo(adresse));
    req
}

async fn json(antwort: axum::response::Response) -> serde_json::Value {
    let bytes = antwort.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&bytes).unwrap()
}

#[tokio::test]
async fn registrierung_liefert_zugang_und_speichert_nur_den_hash() {
    let (app, pool) = aufbau().await;
    let antwort = app.oneshot(registrierung("10.0.0.1")).await.unwrap();
    assert_eq!(antwort.status(), StatusCode::OK);
    let body = json(antwort).await;
    let id = body["server_id"].as_str().unwrap();
    let geheimnis = body["geheimnis"].as_str().unwrap();
    assert!(!id.is_empty() && !geheimnis.is_empty());

    let (hash,): (String,) = sqlx::query_as("SELECT geheimnis_hash FROM server WHERE id = ?")
        .bind(id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_ne!(hash, geheimnis);
    assert_eq!(hash.len(), 64);
    let treffer: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM server WHERE geheimnis_hash = ?")
        .bind(geheimnis)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(treffer, 0);
}

#[tokio::test]
async fn pruefen_erkennt_gueltig_unbekannt_gesperrt() {
    let (_, pool) = aufbau().await;
    let z = speicher::registrieren(&pool, Some("a@b.de"), "1.0.0")
        .await
        .unwrap();
    assert_eq!(
        speicher::pruefen(&pool, &z.server_id, &z.geheimnis)
            .await
            .unwrap(),
        Pruefung::Gueltig
    );
    assert_eq!(
        speicher::pruefen(&pool, &z.server_id, "falsch")
            .await
            .unwrap(),
        Pruefung::Unbekannt
    );
    assert_eq!(
        speicher::pruefen(&pool, "gibt-es-nicht", &z.geheimnis)
            .await
            .unwrap(),
        Pruefung::Unbekannt
    );
    assert!(speicher::sperren(&pool, &z.server_id).await.unwrap());
    assert_eq!(
        speicher::pruefen(&pool, &z.server_id, &z.geheimnis)
            .await
            .unwrap(),
        Pruefung::Gesperrt
    );
    assert!(speicher::entsperren(&pool, &z.server_id).await.unwrap());
    assert_eq!(
        speicher::pruefen(&pool, &z.server_id, &z.geheimnis)
            .await
            .unwrap(),
        Pruefung::Gueltig
    );
    assert!(!speicher::sperren(&pool, "gibt-es-nicht").await.unwrap());
}

#[tokio::test]
async fn registrierungen_sind_je_ip_begrenzt() {
    let (app, _) = aufbau().await;
    for _ in 0..10 {
        let a = app
            .clone()
            .oneshot(registrierung("10.0.0.2"))
            .await
            .unwrap();
        assert_eq!(a.status(), StatusCode::OK);
    }
    let a = app
        .clone()
        .oneshot(registrierung("10.0.0.2"))
        .await
        .unwrap();
    assert_eq!(a.status(), StatusCode::TOO_MANY_REQUESTS);
    // Eine andere IP ist unberührt.
    let a = app.oneshot(registrierung("10.0.0.3")).await.unwrap();
    assert_eq!(a.status(), StatusCode::OK);
}

#[tokio::test]
async fn hinter_proxy_zaehlt_der_erste_forwarded_for_eintrag() {
    let pool = speicher::oeffnen(":memory:").await.unwrap();
    let app = router(RelaisState::neu(
        pool,
        1,
        true,
        gemeinsam::apns_client("http://127.0.0.1:9"),
        600,
    ));
    let mit_xff = |xff: &str| {
        let mut r = registrierung("127.0.0.1");
        r.headers_mut()
            .insert("x-forwarded-for", xff.parse().unwrap());
        r
    };
    let a = app
        .clone()
        .oneshot(mit_xff("203.0.113.5, 10.0.0.1"))
        .await
        .unwrap();
    assert_eq!(a.status(), StatusCode::OK);
    let a = app.clone().oneshot(mit_xff("203.0.113.5")).await.unwrap();
    assert_eq!(a.status(), StatusCode::TOO_MANY_REQUESTS);
    let a = app.oneshot(mit_xff("203.0.113.6")).await.unwrap();
    assert_eq!(a.status(), StatusCode::OK);
}

#[tokio::test]
async fn status_nennt_die_version() {
    let (app, _) = aufbau().await;
    let antwort = app
        .oneshot(Request::get("/v1/status").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(antwort.status(), StatusCode::OK);
    assert_eq!(json(antwort).await["version"], env!("CARGO_PKG_VERSION"));
}
