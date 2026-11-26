//! Livebild der Drohne (LLH-2107): `GET /api/incidents/{id}/drone/video/{key}/hls/{*file}`.
//! Hier die Wege, die vor dem Abruf enden (404) und der Weg ohne Zugang (503); der Abruf selbst
//! ist in `drohne::video` und `adapter::live` geprüft.

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use tower::ServiceExt;

use lifeline_hub::app::build_router;
use lifeline_hub::drohne::store::Stand;
use lifeline_hub::drohne::suchlage::Upstream;
use lifeline_hub::drohne::vertrag::{DrohnenLage, DrohnenVideo};
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
    umgebung_mit(false).await
}

/// Mit `mit_schluessel` ein Rahmen mit Schlüssel und den produktiven Arten: der Live-Abruf wird
/// dann wirklich vorbereitet.
async fn umgebung_mit(mit_schluessel: bool) -> Umgebung {
    let pool = lifeline_hub::db::test_pool().await;
    lifeline_hub::auth::bootstrap::bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12"))
        .await
        .unwrap();
    let mut state = common::test_state(&pool, &LiveHub::new());
    if mit_schluessel {
        use lifeline_hub::adapter::art::Verzeichnis;
        use lifeline_hub::adapter::geheimnis::{GeheimnisSchluessel, Geheimnisspeicher};
        state.adapter = lifeline_hub::adapter::Rahmen::new(
            Geheimnisspeicher::new(Some(GeheimnisSchluessel::generate())),
            Verzeichnis::produktiv(state.drohne.clone(), Default::default()),
        );
    }
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
        self.adapter_anlegen_als(id, "suchlage", "{}", false).await;
    }

    async fn adapter_anlegen_als(&self, id: &str, art: &str, einstellungen: &str, lan: bool) {
        let org_id: i64 = sqlx::query_scalar("SELECT org_id FROM einsatz WHERE id = ?")
            .bind(self.einsatz)
            .fetch_one(&self.pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO adapter (id, org_id, art, name, intervall_s, einstellungen, lan_erlaubt) \
             VALUES (?, ?, ?, 'Drohnen Nord', 30, ?, ?)",
        )
        .bind(id)
        .bind(org_id)
        .bind(art)
        .bind(einstellungen)
        .bind(lan)
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

    fn stand_mit_video(&self, adapter: &str, key: &str) {
        let mut upstream = Upstream::default();
        upstream.videos.insert(key.into(), "SN-GEHEIM".into());
        self.drohne.put(
            adapter,
            Stand {
                lage: DrohnenLage {
                    stand_ms: 1,
                    quelle_stand_ms: 1,
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

    async fn holen(&self, pfad: &str) -> (StatusCode, String) {
        let resp = self
            .app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!(
                        "/api/incidents/{}/drone/video/{pfad}",
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

#[tokio::test]
async fn video_ohne_zuschaltung_404() {
    let u = umgebung().await;
    u.adapter_anlegen("a1").await;
    u.stand_mit_video("a1", "k1");
    let (s, body) = u.holen("k1/hls/index.m3u8").await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    assert!(!body.contains("SN-GEHEIM"));
}

const HLS: &str = r#"{"playlist_url":"http://10.0.0.5:8888/drohne/index.m3u8"}"#;

#[tokio::test]
async fn hls_adresse_nicht_zugeschaltet_404() {
    let u = umgebung().await;
    u.adapter_anlegen_als("h1", "hls_adresse", HLS, true).await;
    u.stand_mit_video("h1", "kh");
    let (s, _) = u.holen("kh/hls/index.m3u8").await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

/// Die Route nimmt die Art des Adapters: der Live-Abruf wird für `hls_adresse` vorbereitet und
/// geht ans Ziel (hier nicht erreichbar: 502), statt als fremde Art verweigert zu werden (503).
#[tokio::test]
async fn hls_adresse_ruft_ueber_die_eigene_art_ab() {
    let u = umgebung_mit(true).await;
    u.adapter_anlegen_als("h1", "hls_adresse", HLS, true).await;
    u.zuschalten("h1").await;
    u.stand_mit_video("h1", "kh");
    let (s, body) = u.holen("kh/hls/index.m3u8").await;
    assert_eq!(s, StatusCode::BAD_GATEWAY, "{body}");
    assert!(!body.contains("10.0.0.5"));
}

#[tokio::test]
async fn fremder_key_404() {
    let u = umgebung().await;
    u.adapter_anlegen("a1").await;
    u.adapter_anlegen("a2").await;
    u.zuschalten("a1").await;
    // Der Schlüssel gehört zu a2, der in diesem Einsatz nicht zugeschaltet ist.
    u.stand_mit_video("a2", "k2");
    let (s, _) = u.holen("k2/hls/index.m3u8").await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (s, _) = u.holen("unbekannt/hls/index.m3u8").await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn datei_mit_schrägstrich_404() {
    let u = umgebung().await;
    u.adapter_anlegen("a1").await;
    u.zuschalten("a1").await;
    u.stand_mit_video("a1", "k1");
    for datei in [
        "a/b.mp4",
        "..%2Fx.mp4",
        "../x.mp4",
        "index.html",
        "x.mp4%00",
    ] {
        let (s, _) = u.holen(&format!("k1/hls/{datei}")).await;
        assert_eq!(s, StatusCode::NOT_FOUND, "{datei}");
    }
}

#[tokio::test]
async fn ohne_zugang_503_ohne_seriennummer() {
    let u = umgebung().await;
    u.adapter_anlegen("a1").await;
    u.zuschalten("a1").await;
    u.stand_mit_video("a1", "k1");
    let (s, body) = u.holen("k1/hls/index.m3u8?x=1").await;
    assert_eq!(s, StatusCode::SERVICE_UNAVAILABLE);
    assert!(!body.contains("SN-GEHEIM"));
}

async fn liste(u: &Umgebung) -> serde_json::Value {
    let (s, v) = anfrage(
        &u.app,
        "GET",
        &format!("/api/incidents/{}/drone/sources", u.einsatz),
        &u.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v:?}");
    v
}

#[tokio::test]
async fn abschluss_beendet_das_livebild_und_leert_den_speicher() {
    let u = umgebung().await;
    u.adapter_anlegen("a1").await;
    u.zuschalten("a1").await;
    u.stand_mit_video("a1", "k1");
    assert_eq!(liste(&u).await[0]["mission_name"], "Suche Waldweg");

    let (s, _) = anfrage(
        &u.app,
        "POST",
        &format!("/api/incidents/{}/close", u.einsatz),
        &u.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert!(!u.drohne.is_zugeschaltet("a1"));
    assert!(u.drohne.get("a1").is_none());
    let (s, _) = u.holen("k1/hls/index.m3u8").await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

/// Tiefenverteidigung: auch mit einer übrig gebliebenen Zeile (etwa aus einem älteren Stand)
/// zeigt ein abgeschlossener Einsatz weder Livebild noch Missionsname.
#[tokio::test]
async fn abgeschlossener_einsatz_mit_alter_zeile_sieht_nichts() {
    let u = umgebung().await;
    u.adapter_anlegen("a1").await;
    u.zuschalten("a1").await;
    sqlx::query("UPDATE einsatz SET status = 'abgeschlossen', abgeschlossen_at = datetime('now') WHERE id = ?")
        .bind(u.einsatz)
        .execute(&u.pool)
        .await
        .unwrap();
    // Ein anderer Einsatz könnte die Quelle inzwischen halten: der Stand ist da.
    u.stand_mit_video("a1", "k1");

    let (s, _) = u.holen("k1/hls/index.m3u8").await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let v = liste(&u).await;
    assert_eq!(v[0]["connected"], false);
    assert!(v[0]["mission_name"].is_null());
    assert!(v[0]["video_keys"].as_array().unwrap().is_empty());
    assert_eq!(v[0]["lagemonitor"], false);
}

#[tokio::test]
async fn adapter_loeschen_leert_den_speicher() {
    let u = umgebung().await;
    u.adapter_anlegen("a1").await;
    u.zuschalten("a1").await;
    u.stand_mit_video("a1", "k1");
    assert!(u.drohne.is_zugeschaltet("a1"));

    let (s, v) = anfrage(&u.app, "DELETE", "/api/admin/adapter/a1", &u.admin, None).await;
    assert_eq!(s, StatusCode::NO_CONTENT, "{v:?}");
    assert!(!u.drohne.is_zugeschaltet("a1"));
    assert!(u.drohne.get("a1").is_none());
    assert!(u.drohne.find_video("k1").is_none());
}
