//! Anfrageprotokoll (LFH-925): die Request-ID des Clients wird nur in zulässiger Form gespiegelt.

use axum::body::Body;
use axum::http::Request;
use lifeline_hub::app::build_router;
use lifeline_hub::db;
use lifeline_hub::live::LiveHub;
use tower::ServiceExt; // oneshot

mod common;

/// Schickt `GET /api/health` mit den gegebenen `x-request-id`-Köpfen und liefert die IDs der
/// Antwort.
async fn gespiegelte_ids(ids: &[&[u8]]) -> Vec<String> {
    let pool = db::test_pool().await;
    let app = build_router(common::test_state(&pool, &LiveHub::new()));
    let mut anfrage = Request::builder().uri("/api/health");
    for id in ids {
        anfrage = anfrage.header("x-request-id", *id);
    }
    let antwort = app
        .oneshot(anfrage.body(Body::empty()).unwrap())
        .await
        .unwrap();
    antwort
        .headers()
        .get_all("x-request-id")
        .iter()
        .map(|w| w.to_str().unwrap().to_string())
        .collect()
}

fn ist_uuid(wert: &str) -> bool {
    uuid::Uuid::parse_str(wert).is_ok()
}

#[tokio::test]
async fn gueltige_request_id_wird_gespiegelt() {
    let id = "Abc-123-".repeat(8);
    assert_eq!(id.len(), 64);
    assert_eq!(gespiegelte_ids(&[id.as_bytes()]).await, vec![id]);
}

#[tokio::test]
async fn ohne_request_id_setzt_der_server_eine_uuid() {
    let ids = gespiegelte_ids(&[]).await;
    assert_eq!(ids.len(), 1);
    assert!(ist_uuid(&ids[0]), "{ids:?}");
}

/// Mutationsprobe: ohne die Prüfschicht vor `SetRequestIdLayer` stünden die 10 KiB in der
/// Antwort.
#[tokio::test]
async fn uebergrosse_request_id_wird_durch_eine_uuid_ersetzt() {
    let riesig = vec![b'a'; 10 * 1024];
    let ids = gespiegelte_ids(&[&riesig]).await;
    assert_eq!(ids.len(), 1);
    assert!(ist_uuid(&ids[0]), "{:?}", &ids[0][..ids[0].len().min(80)]);
}

#[tokio::test]
async fn request_id_mit_unzulaessigen_zeichen_wird_ersetzt() {
    for falsch in [
        &b"mit leerzeichen"[..],
        b"tab\there",
        b"punkt.und/schraeg",
        b"65-zeichen-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    ] {
        let ids = gespiegelte_ids(&[falsch]).await;
        assert_eq!(ids.len(), 1, "{falsch:?}");
        assert!(ist_uuid(&ids[0]), "{falsch:?} → {ids:?}");
    }
}

/// Zwei mitgeschickte IDs: welche gilt, ist unklar, also keine.
#[tokio::test]
async fn doppelte_request_id_wird_ersetzt() {
    let ids = gespiegelte_ids(&[b"eins", b"zwei"]).await;
    assert_eq!(ids.len(), 1);
    assert!(ist_uuid(&ids[0]), "{ids:?}");
}
