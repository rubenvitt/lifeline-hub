//! Drohnenlage als Fachebene (LLH-2106): `GET /api/incidents/{id}/map/drone`.

use std::sync::Arc;

use axum::body::{to_bytes, Body};
use axum::http::{header, HeaderMap, Request, StatusCode};
use serde_json::{json, Value};
use tower::ServiceExt;

use lifeline_hub::app::build_router;
use lifeline_hub::drohne::store::Stand;
use lifeline_hub::drohne::suchlage::Upstream;
use lifeline_hub::drohne::vertrag::{DrohnenFoto, DrohnenLage, Fluggeraet};
use lifeline_hub::drohne::Store;
use lifeline_hub::live::LiveHub;

mod common;
use common::{anfrage, einsatz_anlegen_mit, fremde_org_anlegen, login_cookie};

struct Umgebung {
    app: axum::Router,
    pool: sqlx::SqlitePool,
    drohne: Arc<Store>,
    admin: String,
    einsatz: i64,
}

async fn umgebung() -> Umgebung {
    let pool = lifeline_hub::db::test_pool().await;
    lifeline_hub::auth::bootstrap::bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12"))
        .await
        .unwrap();
    let state = common::test_state(&pool, &LiveHub::new());
    let drohne = state.drohne.clone();
    let app = build_router(state);
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen_mit(&app, &admin, "Lage A").await;
    Umgebung {
        app,
        pool,
        drohne,
        admin,
        einsatz,
    }
}

impl Umgebung {
    async fn adapter_zuschalten(&self) {
        let org_id: i64 = sqlx::query_scalar("SELECT org_id FROM einsatz WHERE id = ?")
            .bind(self.einsatz)
            .fetch_one(&self.pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO adapter (id, org_id, art, name, intervall_s) VALUES ('a1', ?, 'suchlage', 'Drohnen Nord', 30)",
        )
        .bind(org_id)
        .execute(&self.pool)
        .await
        .unwrap();
        let (s, v) = anfrage(
            &self.app,
            "PUT",
            &format!("/api/incidents/{}/drone/sources/a1", self.einsatz),
            &self.admin,
            Some(r#"{"lagemonitor":false}"#),
        )
        .await;
        assert_eq!(s, StatusCode::OK, "{v:?}");
    }

    fn stand_setzen(&self) {
        let jetzt_ms = chrono::Utc::now().timestamp_millis();
        let foto = |key: &str, ms: i64| DrohnenFoto {
            key: key.into(),
            taken_at_ms: ms,
            position: [8.1, 49.2],
            lens: "wide".into(),
            heading_deg: None,
            relative_altitude_m: None,
        };
        self.drohne.put(
            "a1",
            Stand {
                lage: DrohnenLage {
                    stand_ms: 1_800_000_000_000,
                    quelle_stand_ms: 1_800_000_000_000,
                    mission_name: None,
                    fluggeraete: vec![Fluggeraet {
                        key: "g1".into(),
                        label: "Drohne 1".into(),
                        position: Some([8.0, 49.0]),
                        heading_deg: Some(10.0),
                        height_m: None,
                        battery_percent: Some(80),
                        airborne: true,
                    }],
                    karte: None,
                    videos: vec![],
                    fotos: vec![foto("alt", 1000), foto("neu", jetzt_ms + 60_000)],
                    verworfen: 0,
                },
                map_etag: None,
                photos_latest_ms: None,
                upstream: Upstream::default(),
            },
        );
    }

    async fn holen(
        &self,
        einsatz: i64,
        cookie: &str,
        inm: Option<&str>,
    ) -> (StatusCode, HeaderMap, Value) {
        let mut req = Request::builder()
            .method("GET")
            .uri(format!("/api/incidents/{einsatz}/map/drone"))
            .header(header::COOKIE, cookie);
        if let Some(e) = inm {
            req = req.header(header::IF_NONE_MATCH, e);
        }
        let resp = self
            .app
            .clone()
            .oneshot(req.body(Body::empty()).unwrap())
            .await
            .unwrap();
        let status = resp.status();
        let headers = resp.headers().clone();
        let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let body = serde_json::from_slice(&bytes).unwrap_or(json!(null));
        (status, headers, body)
    }
}

#[tokio::test]
async fn ohne_zuschaltung_offline() {
    let u = umgebung().await;
    let (s, _, v) = u.holen(u.einsatz, &u.admin, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v["status"], "offline");
    assert!(v["features"]["features"].as_array().unwrap().is_empty());
}

#[tokio::test]
async fn zugeschaltet_ohne_stand_offline() {
    let u = umgebung().await;
    u.adapter_zuschalten().await;
    let (_, _, v) = u.holen(u.einsatz, &u.admin, None).await;
    assert_eq!(v["status"], "offline");
}

#[tokio::test]
async fn mit_stand_liefert_features_und_etag() {
    let u = umgebung().await;
    u.adapter_zuschalten().await;
    u.stand_setzen();
    let (s, h, v) = u.holen(u.einsatz, &u.admin, None).await;
    assert_eq!(s, StatusCode::OK);
    assert!(h.contains_key(header::ETAG));
    assert_eq!(v["status"], "ok");
    assert_eq!(v["abgerufen"], "2027-01-15T08:00:00Z");
    let kinds: Vec<&str> = v["features"]["features"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| f["properties"]["kind"].as_str().unwrap())
        .collect();
    // Das Foto von vor dem Zuschalten fehlt.
    assert_eq!(kinds, ["aircraft", "photo"]);
    assert_eq!(v["features"]["features"][1]["properties"]["key"], "neu");
}

#[tokio::test]
async fn gleicher_stand_ergibt_304() {
    let u = umgebung().await;
    u.adapter_zuschalten().await;
    u.stand_setzen();
    let (_, h, _) = u.holen(u.einsatz, &u.admin, None).await;
    let etag = h[header::ETAG].to_str().unwrap().to_string();
    let (s, _, _) = u.holen(u.einsatz, &u.admin, Some(&etag)).await;
    assert_eq!(s, StatusCode::NOT_MODIFIED);
}

/// Wer nicht Mitglied ist und in einer fremden Organisation steht, bekommt 403 (Konvention
/// des Einsatzkontexts, `fordere_org_zugehoerigkeit`), nie Daten.
#[tokio::test]
async fn andere_org_hat_keinen_zugriff() {
    let u = umgebung().await;
    fremde_org_anlegen(&u.pool, "Fremd", "fremd", "fremdpw12", "fuehrungskraft").await;
    let fremd = login_cookie(&u.app, "fremd", "fremdpw12").await;
    let (s, _, v) = u.holen(u.einsatz, &fremd, None).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    assert!(v.get("features").is_none());
}

#[tokio::test]
async fn abgeschlossener_einsatz_ist_offline() {
    let u = umgebung().await;
    u.adapter_zuschalten().await;
    let (s, _) = anfrage(
        &u.app,
        "POST",
        &format!("/api/incidents/{}/close", u.einsatz),
        &u.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    // Auch wenn ein Stand im Speicher liegt (etwa für einen anderen Einsatz).
    u.stand_setzen();
    let (s, _, v) = u.holen(u.einsatz, &u.admin, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v["status"], "offline");
    assert!(v["features"]["features"].as_array().unwrap().is_empty());
}
