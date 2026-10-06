//! LFH-937: Geometrien von Zonen und Abschnittsflächen (Spec `eingabegrenzen`, design.md D7):
//! Grenzen und Struktur sind 400, kaputtes JSON und ein falscher Typ bleiben 422. Zugleich der
//! erste Integrationstest für `PATCH …/abschnitte/{aid}/flaeche`.

use axum::http::StatusCode;
use serde_json::{json, Value};

mod common;
use common::{anfrage_json, einsatz_anlegen, login_cookie, setup};

/// Geschlossener Ring aus `n` Positionen um (9, 51), wie ihn terra-draw liefert.
fn ring(n: usize) -> Vec<[f64; 2]> {
    let mut p: Vec<[f64; 2]> = (0..n - 1)
        .map(|i| {
            let w = i as f64 / (n - 1) as f64 * std::f64::consts::TAU;
            [9.0 + 0.01 * w.cos(), 51.0 + 0.01 * w.sin()]
        })
        .collect();
    p.push(p[0]);
    p
}

fn polygon(n: usize) -> String {
    json!({ "type": "Polygon", "coordinates": [ring(n)] }).to_string()
}

async fn zone(app: &axum::Router, cookie: &str, e: i64, geometrie: &str) -> (StatusCode, Value) {
    anfrage_json(
        app,
        "POST",
        &format!("/api/einsaetze/{e}/zonen"),
        cookie,
        Some(
            &json!({ "typ": "gefahrengebiet", "geometrie_typ": "Polygon", "geometrie": geometrie }),
        ),
    )
    .await
}

#[tokio::test]
async fn zone_mit_5001_punkten_ist_400_und_kaputtes_json_bleibt_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;

    let (s, j) = zone(&app, &admin, e, &polygon(5)).await;
    assert_eq!(s, StatusCode::CREATED, "gezeichnete Zone: {j:?}");
    let (s, j) = zone(&app, &admin, e, &polygon(5_000)).await;
    assert_eq!(s, StatusCode::CREATED, "{j:?}");

    let (s, j) = zone(&app, &admin, e, &polygon(5_001)).await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{j:?}");
    let (s, _) = zone(
        &app,
        &admin,
        e,
        r#"{"type":"Polygon","coordinates":[[["a",51],[9,51],[9,52],["a",51]]]}"#,
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    let (s, _) = zone(&app, &admin, e, "kein json").await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
    let (s, _) = zone(&app, &admin, e, r#"{"type":"LineString","coordinates":[]}"#).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);

    let (_, liste) = anfrage_json(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/zonen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(liste.as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn abschnittsflaeche_gueltig_400_und_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (_, a) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/abschnitte"),
        &admin,
        Some(&json!({ "name": "Nord" })),
    )
    .await;
    let aid = a["id"].as_i64().unwrap();
    let uri = format!("/api/einsaetze/{e}/abschnitte/{aid}/flaeche");
    let setze = |geo: String| json!({ "flaeche_geojson": geo });

    let (s, j) = anfrage_json(&app, "PATCH", &uri, &admin, Some(&setze(polygon(6)))).await;
    assert_eq!(s, StatusCode::OK, "{j:?}");
    assert!(j["flaeche_geojson"].is_string(), "{j:?}");

    let ausserhalb = r#"{"type":"Polygon","coordinates":[[[9,91],[9,51],[10,51],[9,91]]]}"#;
    for (geo, erwartet) in [
        (polygon(5_001), StatusCode::BAD_REQUEST),
        (
            r#"{"type":"Polygon","coordinates":[[["a",52],[9,51],[9,52],["a",52]]]}"#.to_string(),
            StatusCode::BAD_REQUEST,
        ),
        (ausserhalb.to_string(), StatusCode::BAD_REQUEST),
        ("{".to_string(), StatusCode::UNPROCESSABLE_ENTITY),
        (
            r#"{"type":"LineString","coordinates":[[9,51],[9,52]]}"#.to_string(),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
    ] {
        let (s, j) = anfrage_json(&app, "PATCH", &uri, &admin, Some(&setze(geo))).await;
        assert_eq!(s, erwartet, "{j:?}");
    }

    // Die zuerst gesetzte Fläche ist unverändert.
    let (_, j) = anfrage_json(&app, "PATCH", &uri, &admin, Some(&json!({}))).await;
    assert_eq!(j["flaeche_geojson"], polygon(6));
}
