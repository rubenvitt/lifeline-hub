//! Livebild der Drohne auf dem Lagemonitor (LLH-2109): der Block `drohne` in
//! `GET /api/incidents/{id}/situation-monitor` und der Weg des gekoppelten Monitors zum
//! Video-Proxy, beides nur bei eingeschaltetem Schalter „Livebild auf dem Lagemonitor“.

use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use serde_json::{json, Value};
use std::sync::Arc;
use tower::ServiceExt;

use lifeline_hub::app::build_router;
use lifeline_hub::drohne::store::Stand;
use lifeline_hub::drohne::suchlage::Upstream;
use lifeline_hub::drohne::vertrag::{DrohnenLage, DrohnenVideo};
use lifeline_hub::drohne::Store;
use lifeline_hub::live::LiveHub;

mod common;
use common::{anfrage, anfrage_json, einsatz_anlegen_mit, login_cookie};

/// Zeit des Abrufs bei uns im Testspeicher: 24.11.2025 16:00:00 UTC.
const STAND_MS: i64 = 1_764_000_000_000;

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
    let u = Umgebung {
        app,
        pool,
        drohne,
        admin,
        einsatz,
    };
    u.adapter_anlegen("dro1").await;
    u
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

    async fn schalten(&self, lagemonitor: bool) {
        let (s, v) = anfrage(
            &self.app,
            "PUT",
            &format!("/api/incidents/{}/drone/sources/dro1", self.einsatz),
            &self.admin,
            Some(&json!({ "lagemonitor": lagemonitor }).to_string()),
        )
        .await;
        assert_eq!(s, StatusCode::OK, "{v:?}");
    }

    fn stand_mit_video(&self, key: &str) {
        let mut upstream = Upstream::default();
        upstream.videos.insert(key.into(), "SN-GEHEIM".into());
        self.drohne.put(
            "dro1",
            Stand {
                lage: DrohnenLage {
                    stand_ms: STAND_MS,
                    quelle_stand_ms: STAND_MS,
                    mission_name: Some("Suche Waldweg".into()),
                    fluggeraete: vec![],
                    karte: None,
                    videos: vec![DrohnenVideo { key: key.into() }],
                    fotos: vec![],
                    verworfen: 0,
                },
                map_etag: None,
                photos_latest_ms: None,
                upstream,
            },
        );
    }

    /// Ein gekoppeltes Gerät der Ansicht `body` (Cookie der Gerätesitzung).
    async fn geraet(&self, body: Value) -> String {
        let (s, v) = anfrage_json(
            &self.app,
            "POST",
            &format!("/api/incidents/{}/devices", self.einsatz),
            &self.admin,
            Some(&body),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{v}");
        let code = v["code"]["code"].as_str().unwrap().to_string();
        let resp = self
            .app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/devices/pair")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(json!({ "code": code }).to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        resp.headers()
            .get(header::SET_COOKIE)
            .map(|v| v.to_str().unwrap().split(';').next().unwrap().to_string())
            .expect("Sitzungscookie")
    }

    async fn monitor(&self) -> String {
        self.geraet(json!({"ansicht": "lagemonitor", "bezeichnung": "Monitor Stab"}))
            .await
    }

    async fn lagebild(&self, monitor: &str) -> Value {
        let (s, v) = anfrage(
            &self.app,
            "GET",
            &format!("/api/incidents/{}/situation-monitor", self.einsatz),
            monitor,
            None,
        )
        .await;
        assert_eq!(s, StatusCode::OK, "{v:?}");
        v
    }

    async fn video(&self, cookie: &str, key: &str) -> StatusCode {
        let resp = self
            .app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!(
                        "/api/incidents/{}/drone/video/{key}/hls/index.m3u8",
                        self.einsatz
                    ))
                    .header(header::COOKIE, cookie)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let s = resp.status();
        let _ = to_bytes(resp.into_body(), usize::MAX).await;
        s
    }
}

#[tokio::test]
async fn ohne_schalter_kein_block() {
    let u = umgebung().await;
    u.schalten(false).await;
    u.stand_mit_video("v1");
    let monitor = u.monitor().await;
    let v = u.lagebild(&monitor).await;
    assert!(v.get("drohne").is_none(), "{v}");
}

#[tokio::test]
async fn ohne_zuschaltung_kein_block() {
    let u = umgebung().await;
    let monitor = u.monitor().await;
    let v = u.lagebild(&monitor).await;
    assert!(v.get("drohne").is_none(), "{v}");
}

#[tokio::test]
async fn mit_schalter_block_mit_videos_und_stand() {
    let u = umgebung().await;
    u.schalten(true).await;
    u.stand_mit_video("v1");
    let monitor = u.monitor().await;
    let v = u.lagebild(&monitor).await;
    assert_eq!(v["drohne"]["videos"], json!(["v1"]), "{v}");
    assert_eq!(v["drohne"]["stand_at"], "2025-11-24 16:00:00", "{v}");
    // Keine Seriennummer, kein Missionsname auf dem Großbild.
    let text = v.to_string();
    assert!(
        !text.contains("SN-GEHEIM") && !text.contains("Waldweg"),
        "{text}"
    );
}

#[tokio::test]
async fn mit_schalter_ohne_stand_leere_liste() {
    let u = umgebung().await;
    u.schalten(true).await;
    let zugeschaltet_at: String =
        sqlx::query_scalar("SELECT zugeschaltet_at FROM adapter_einsatz WHERE adapter_id = 'dro1'")
            .fetch_one(&u.pool)
            .await
            .unwrap();
    let monitor = u.monitor().await;
    let v = u.lagebild(&monitor).await;
    assert_eq!(v["drohne"]["videos"], json!([]), "{v}");
    assert_eq!(v["drohne"]["stand_at"], zugeschaltet_at, "{v}");
}

#[tokio::test]
async fn ausgeschaltet_nimmt_den_block_wieder_weg() {
    let u = umgebung().await;
    u.schalten(true).await;
    u.stand_mit_video("v1");
    let monitor = u.monitor().await;
    assert!(u.lagebild(&monitor).await.get("drohne").is_some());
    u.schalten(false).await;
    assert!(u.lagebild(&monitor).await.get("drohne").is_none());
}

#[tokio::test]
async fn ausgeblendete_lagekarte_kein_block() {
    let u = umgebung().await;
    u.schalten(true).await;
    u.stand_mit_video("v1");
    let (s, v) = anfrage(
        &u.app,
        "PUT",
        &format!("/api/incidents/{}/module-overrides/lagekarte", u.einsatz),
        &u.admin,
        Some(r#"{"sichtbar":false,"benoetigte_rolle":null}"#),
    )
    .await;
    assert!(s.is_success(), "{s} {v:?}");
    let monitor = u.monitor().await;
    let v = u.lagebild(&monitor).await;
    assert!(v.get("drohne").is_none(), "{v}");
}

#[tokio::test]
async fn abgeschlossener_einsatz_findet_keine_zuschaltung() {
    let u = umgebung().await;
    u.schalten(true).await;
    sqlx::query("UPDATE einsatz SET status = 'abgeschlossen' WHERE id = ?")
        .bind(u.einsatz)
        .execute(&u.pool)
        .await
        .unwrap();
    let mut conn = u.pool.acquire().await.unwrap();
    let z = lifeline_hub::drohne::repo::find_lagemonitor(&mut conn, u.einsatz)
        .await
        .unwrap();
    assert!(z.is_none());
}

// ---------- Video-Proxy für den gekoppelten Lagemonitor (Task 2) ----------

#[tokio::test]
async fn monitor_bei_schalter_aus_404() {
    let u = umgebung().await;
    u.schalten(false).await;
    u.stand_mit_video("v1");
    let monitor = u.monitor().await;
    assert_eq!(u.video(&monitor, "v1").await, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn monitor_bei_schalter_an_erreicht_den_abruf() {
    let u = umgebung().await;
    u.schalten(true).await;
    u.stand_mit_video("v1");
    let monitor = u.monitor().await;
    // Ohne Geheimnis im Speicher endet der Abruf mit 503 (wie für Personen): die Prüfungen davor
    // hat der Monitor bestanden.
    assert_eq!(
        u.video(&monitor, "v1").await,
        StatusCode::SERVICE_UNAVAILABLE
    );
}

#[tokio::test]
async fn ausschalten_sperrt_den_monitor_sofort() {
    let u = umgebung().await;
    u.schalten(true).await;
    u.stand_mit_video("v1");
    let monitor = u.monitor().await;
    assert_ne!(u.video(&monitor, "v1").await, StatusCode::NOT_FOUND);
    u.schalten(false).await;
    assert_eq!(u.video(&monitor, "v1").await, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn person_braucht_den_schalter_nicht() {
    let u = umgebung().await;
    u.schalten(false).await;
    u.stand_mit_video("v1");
    assert_eq!(
        u.video(&u.admin, "v1").await,
        StatusCode::SERVICE_UNAVAILABLE
    );
}

#[tokio::test]
async fn andere_ansicht_erreicht_den_proxy_nie() {
    let u = umgebung().await;
    u.schalten(true).await;
    u.stand_mit_video("v1");
    let (s, v) = anfrage_json(
        &u.app,
        "POST",
        &format!("/api/incidents/{}/uhs", u.einsatz),
        &u.admin,
        Some(&json!({"typ": "behandlungsplatz", "bezeichnung": "UHS Nord"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let uhs = v["id"].as_i64().unwrap();
    let tablet = u
        .geraet(json!({"ansicht": "uhs-tablet", "uhs_id": uhs, "bezeichnung": "Tablet 1"}))
        .await;
    assert_eq!(u.video(&tablet, "v1").await, StatusCode::FORBIDDEN);
}
