//! Vorschau der Drohnenfotos (LLH-2108): `GET /api/incidents/{id}/drone/photos/{key}/thumb`.
//! Hier die Wege, die vor dem Abruf enden (404) und der Weg ohne Zugang (503); Bereinigung und
//! Adressprüfung sind in `drohne::foto` und `drohne::suchlage` geprüft.

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use tower::ServiceExt;

use lifeline_hub::app::build_router;
use lifeline_hub::drohne::store::Stand;
use lifeline_hub::drohne::suchlage::Upstream;
use lifeline_hub::drohne::vertrag::{DrohnenFoto, DrohnenLage};
use lifeline_hub::drohne::Store;
use lifeline_hub::live::LiveHub;
use std::sync::Arc;

mod common;
use common::{anfrage, einsatz_anlegen_mit, login_cookie};

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
    async fn adapter_anlegen(&self, id: &str) {
        let org_id: i64 = sqlx::query_scalar("SELECT org_id FROM einsatz WHERE id = ?")
            .bind(self.einsatz)
            .fetch_one(&self.pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO adapter (id, org_id, art, name, intervall_s) VALUES (?, ?, 'suchlage', 'Drohnen Nord', 30)",
        )
        .bind(id)
        .bind(org_id)
        .execute(&self.pool)
        .await
        .unwrap();
    }

    async fn zuschalten(&self, id: &str) {
        let (s, v) = anfrage(
            &self.app,
            "PUT",
            &format!("/api/incidents/{}/drone/sources/{id}", self.einsatz),
            &self.admin,
            Some(r#"{"lagemonitor":false}"#),
        )
        .await;
        assert_eq!(s, StatusCode::OK, "{v:?}");
    }

    fn stand_mit_foto(&self, adapter: &str, key: &str, taken_at_ms: i64) {
        let mut upstream = Upstream::default();
        upstream
            .fotos
            .insert(key.into(), "/api/lagemonitor/v1/photos/17/thumb?v=1".into());
        self.drohne.put(
            adapter,
            Stand {
                lage: DrohnenLage {
                    stand_ms: 1,
                    quelle_stand_ms: 1,
                    mission_name: None,
                    fluggeraete: vec![],
                    karte: None,
                    videos: vec![],
                    fotos: vec![DrohnenFoto {
                        key: key.into(),
                        taken_at_ms,
                        position: [8.0, 50.0],
                        lens: "wide".into(),
                        heading_deg: None,
                        relative_altitude_m: None,
                    }],
                    verworfen: 0,
                },
                map_etag: None,
                photos_latest_ms: Some(taken_at_ms),
                upstream,
            },
        );
    }

    async fn holen(&self, pfad: &str) -> (StatusCode, String) {
        let resp = self
            .app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!(
                        "/api/incidents/{}/drone/photos/{pfad}",
                        self.einsatz
                    ))
                    .header(header::COOKIE, &self.admin)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = resp.status();
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        (status, String::from_utf8_lossy(&bytes).into_owned())
    }
}

/// Weit in der Zukunft: sicher nach jedem Zuschalten.
const SPAETER_MS: i64 = 4_102_444_800_000;

#[tokio::test]
async fn foto_ohne_zuschaltung_404() {
    let u = umgebung().await;
    u.adapter_anlegen("a1").await;
    u.stand_mit_foto("a1", "f1", SPAETER_MS);
    let (s, body) = u.holen("f1/thumb").await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    assert!(!body.contains("/photos/"));
}

#[tokio::test]
async fn foto_vor_dem_zuschalten_404() {
    let u = umgebung().await;
    u.adapter_anlegen("a1").await;
    u.zuschalten("a1").await;
    u.stand_mit_foto("a1", "f1", 1_700_000_000_000);
    let (s, _) = u.holen("f1/thumb").await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn fremder_key_404() {
    let u = umgebung().await;
    u.adapter_anlegen("a1").await;
    u.adapter_anlegen("a2").await;
    u.zuschalten("a1").await;
    // Der Schlüssel gehört zu a2, der in diesem Einsatz nicht zugeschaltet ist.
    u.stand_mit_foto("a2", "f2", SPAETER_MS);
    let (s, _) = u.holen("f2/thumb").await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (s, _) = u.holen("unbekannt/thumb").await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn zugelassenes_foto_ohne_zugang_503() {
    let u = umgebung().await;
    u.adapter_anlegen("a1").await;
    u.zuschalten("a1").await;
    u.stand_mit_foto("a1", "f1", SPAETER_MS);
    let (s, body) = u.holen("f1/thumb").await;
    assert_eq!(s, StatusCode::SERVICE_UNAVAILABLE);
    assert!(!body.contains("/photos/"));
}
