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

/// Review B-I2: hinter dem Proxy zählt der Eintrag, den der eigene Proxy anhängt, also der
/// rechte. Den linken setzt der Client selbst; mit ihm umginge jeder die Grenze.
#[tokio::test]
async fn hinter_proxy_zaehlt_der_rechte_forwarded_for_eintrag() {
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
        .oneshot(mit_xff("198.51.100.1, 203.0.113.5"))
        .await
        .unwrap();
    assert_eq!(a.status(), StatusCode::OK);
    // Ein anderer, vom Client gesetzter linker Eintrag ändert nichts.
    let a = app
        .clone()
        .oneshot(mit_xff("198.51.100.2, 203.0.113.5"))
        .await
        .unwrap();
    assert_eq!(a.status(), StatusCode::TOO_MANY_REQUESTS);
    let a = app.clone().oneshot(mit_xff("203.0.113.5")).await.unwrap();
    assert_eq!(a.status(), StatusCode::TOO_MANY_REQUESTS);
    let a = app.oneshot(mit_xff("203.0.113.6")).await.unwrap();
    assert_eq!(a.status(), StatusCode::OK);
}

/// Review B-I2: IPv6 zählt je /64; jeder VPS hat eines und wechselte sonst einfach die Adresse.
#[tokio::test]
async fn ipv6_zaehlt_je_64er_netz() {
    let (app, _) = aufbau().await;
    for i in 1..=10 {
        let a = app
            .clone()
            .oneshot(registrierung(&format!("[2001:db8:1:2::{i:x}]")))
            .await
            .unwrap();
        assert_eq!(a.status(), StatusCode::OK);
    }
    let a = app
        .clone()
        .oneshot(registrierung("[2001:db8:1:2:ffff::1]"))
        .await
        .unwrap();
    assert_eq!(a.status(), StatusCode::TOO_MANY_REQUESTS);
    let a = app
        .oneshot(registrierung("[2001:db8:1:3::1]"))
        .await
        .unwrap();
    assert_eq!(a.status(), StatusCode::OK);
}

fn registrierung_mit(body: String) -> Request<Body> {
    let mut req = Request::post("/v1/server")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body))
        .unwrap();
    let adresse: SocketAddr = "10.0.0.9:4000".parse().unwrap();
    req.extensions_mut().insert(ConnectInfo(adresse));
    req
}

/// Review B-I2: Körper und Felder der Registrierung sind klein begrenzt; ein Angreifer schreibt
/// sonst Megabytes je Aufruf in die Datenbank.
#[tokio::test]
async fn registrierung_begrenzt_koerper_und_felder() {
    let (app, pool) = aufbau().await;
    let status = |body: serde_json::Value| {
        let app = app.clone();
        async move {
            app.oneshot(registrierung_mit(body.to_string()))
                .await
                .unwrap()
                .status()
        }
    };
    assert_eq!(
        status(serde_json::json!({ "version": "1.0.0", "kontakt": "x".repeat(5000) })).await,
        StatusCode::PAYLOAD_TOO_LARGE
    );
    assert_eq!(
        status(serde_json::json!({ "version": "1.0.0", "kontakt": "x".repeat(201) })).await,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        status(serde_json::json!({ "version": "1.0.0", "kontakt": "a@b.de\nX-Boese: 1" })).await,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        status(serde_json::json!({ "version": "1".repeat(65) })).await,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        status(serde_json::json!({ "version": "" })).await,
        StatusCode::BAD_REQUEST
    );
    let zahl: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM server")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(zahl, 0, "nichts gespeichert");
    assert_eq!(
        status(serde_json::json!({ "version": "1".repeat(64), "kontakt": "x".repeat(200) })).await,
        StatusCode::OK
    );
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
