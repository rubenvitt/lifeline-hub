use axum::{
    body::{to_bytes, Body},
    http::{header, Request, StatusCode},
    Router,
};
use serde_json::{json, Value};
use tower::ServiceExt;

mod common;

#[tokio::test]
async fn schwaerzung_entfernt_fuehrungsstelle_nur_im_betroffenen_einsatz() {
    let (app, pool) = common::setup_mit_pool().await;
    let admin = common::login_cookie(&app, "admin", "startpw12").await;
    let mut ids = Vec::new();
    for name in ["A", "B"] {
        let (_, e) = request(
            &app,
            &admin,
            "POST",
            "/api/einsaetze",
            json!({"bezeichnung": name}),
        )
        .await;
        let id = e["id"].as_i64().unwrap();
        assert_eq!(
            request(
                &app,
                &admin,
                "PUT",
                &format!("/api/einsaetze/{id}/mitglieder/1"),
                json!({"einsatz_rolle": "einsatzleitung", "fuehrungsstelle": name})
            )
            .await
            .0,
            StatusCode::OK
        );
        ids.push(id);
    }
    let mut tx = pool.begin().await.unwrap();
    lifeline_hub::einsatz::schwaerzung_registry::scrubbe_aus_registry(&mut tx, ids[0])
        .await
        .unwrap();
    tx.commit().await.unwrap();
    let stellen: Vec<Option<String>> = sqlx::query_scalar(
        "SELECT fuehrungsstelle FROM einsatz_mitgliedschaft ORDER BY einsatz_id",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(stellen, vec![None, Some("B".to_string())]);
}

async fn request(
    app: &Router,
    cookie: &str,
    method: &str,
    uri: &str,
    body: Value,
) -> (StatusCode, Value) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(uri)
                .header(header::COOKIE, cookie)
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

#[tokio::test]
async fn fuehrungsstelle_ist_je_mitgliedschaft_und_rollenwechsel_erhaelt_sie() {
    let app = common::setup().await;
    let admin = common::login_cookie(&app, "admin", "startpw12").await;
    let (_, a) = request(
        &app,
        &admin,
        "POST",
        "/api/einsaetze",
        json!({"bezeichnung": "A"}),
    )
    .await;
    let (_, b) = request(
        &app,
        &admin,
        "POST",
        "/api/einsaetze",
        json!({"bezeichnung": "B"}),
    )
    .await;
    let aid = a["id"].as_i64().unwrap();
    let bid = b["id"].as_i64().unwrap();
    let erika_id = common::benutzer_anlegen(&app, &admin, "erika", "keine").await;
    let erika = common::login_cookie(&app, "erika", "erikapw1").await;
    for (eid, stelle) in [(aid, "Florian A"), (bid, "Florian B")] {
        let (status, mitglieder) = request(&app, &admin, "PUT",
            &format!("/api/einsaetze/{eid}/mitglieder/{erika_id}"),
            json!({"einsatz_rolle": "fuehrungspersonal", "fuehrungsstelle": format!("  {stelle}  ")})).await;
        assert_eq!(status, StatusCode::OK);
        let mitglied = mitglieder
            .as_array()
            .unwrap()
            .iter()
            .find(|m| m["benutzer_id"] == erika_id)
            .unwrap();
        assert_eq!(mitglied["fuehrungsstelle"], stelle);
        let (_, detail) = request(
            &app,
            &erika,
            "GET",
            &format!("/api/einsaetze/{eid}"),
            Value::Null,
        )
        .await;
        assert_eq!(detail["meine_fuehrungsstelle"], stelle);
        let (_, admin_detail) = request(
            &app,
            &admin,
            "GET",
            &format!("/api/einsaetze/{eid}"),
            Value::Null,
        )
        .await;
        assert!(!admin_detail
            .as_object()
            .unwrap()
            .contains_key("meine_fuehrungsstelle"));
    }
    let (_, liste) = request(&app, &erika, "GET", "/api/einsaetze", Value::Null).await;
    for (eid, stelle) in [(aid, "Florian A"), (bid, "Florian B")] {
        assert_eq!(
            liste
                .as_array()
                .unwrap()
                .iter()
                .find(|e| e["id"] == eid)
                .unwrap()["meine_fuehrungsstelle"],
            stelle
        );
    }
    let uri = format!("/api/einsaetze/{aid}/mitglieder/{erika_id}");
    let (status, _) = request(
        &app,
        &admin,
        "PUT",
        &uri,
        json!({"einsatz_rolle": "beobachter"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (_, detail) = request(
        &app,
        &erika,
        "GET",
        &format!("/api/einsaetze/{aid}"),
        Value::Null,
    )
    .await;
    assert_eq!(detail["meine_fuehrungsstelle"], "Florian A");
    assert_eq!(detail["meine_rolle"], "beobachter");
    for leer in [Value::Null, json!("   ")] {
        request(
            &app,
            &admin,
            "PUT",
            &uri,
            json!({"einsatz_rolle": "beobachter", "fuehrungsstelle": "Neu"}),
        )
        .await;
        let (status, mitglieder) = request(
            &app,
            &admin,
            "PUT",
            &uri,
            json!({"einsatz_rolle": "beobachter", "fuehrungsstelle": leer}),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let mitglied = mitglieder
            .as_array()
            .unwrap()
            .iter()
            .find(|m| m["benutzer_id"] == erika_id)
            .unwrap();
        assert!(!mitglied
            .as_object()
            .unwrap()
            .contains_key("fuehrungsstelle"));
        let (_, detail) = request(
            &app,
            &erika,
            "GET",
            &format!("/api/einsaetze/{aid}"),
            Value::Null,
        )
        .await;
        assert!(!detail
            .as_object()
            .unwrap()
            .contains_key("meine_fuehrungsstelle"));
    }
}

#[tokio::test]
async fn fuehrungsstelle_schreibschutz_validierung_und_org_grenze() {
    let (app, pool) = common::setup_mit_pool().await;
    let admin = common::login_cookie(&app, "admin", "startpw12").await;
    let (_, e) = request(
        &app,
        &admin,
        "POST",
        "/api/einsaetze",
        json!({"bezeichnung": "A"}),
    )
    .await;
    let eid = e["id"].as_i64().unwrap();
    let erika_id = common::benutzer_anlegen(&app, &admin, "erika", "keine").await;
    let erika = common::login_cookie(&app, "erika", "erikapw1").await;
    let uri = format!("/api/einsaetze/{eid}/mitglieder/{erika_id}");
    let body = json!({"einsatz_rolle": "fuehrungspersonal", "fuehrungsstelle": "Florian A"});
    assert_eq!(
        request(&app, &admin, "PUT", &uri, body.clone()).await.0,
        StatusCode::OK
    );
    assert_eq!(
        request(&app, &erika, "PUT", &uri, body.clone()).await.0,
        StatusCode::FORBIDDEN
    );
    for ungueltig in [json!(42), json!("x".repeat(201))] {
        assert_eq!(
            request(
                &app,
                &admin,
                "PUT",
                &uri,
                json!({"einsatz_rolle": "beobachter", "fuehrungsstelle": ungueltig})
            )
            .await
            .0,
            StatusCode::BAD_REQUEST
        );
    }
    let (_, fremd_id) =
        common::fremde_org_anlegen(&pool, "Fremd", "fremd", "fremdpw12", "keine").await;
    assert_eq!(
        request(
            &app,
            &admin,
            "PUT",
            &format!("/api/einsaetze/{eid}/mitglieder/{fremd_id}"),
            body.clone()
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    let (_, detail) = request(
        &app,
        &erika,
        "GET",
        &format!("/api/einsaetze/{eid}"),
        Value::Null,
    )
    .await;
    assert_eq!(detail["meine_fuehrungsstelle"], "Florian A");
    assert_eq!(
        detail["meine_rolle"], "fuehrungspersonal",
        "ungueltige Stelle darf die Rolle nicht aendern"
    );
    request(
        &app,
        &admin,
        "POST",
        &format!("/api/einsaetze/{eid}/abschliessen"),
        json!({}),
    )
    .await;
    assert_eq!(
        request(&app, &admin, "PUT", &uri, body).await.0,
        StatusCode::CONFLICT
    );
}
