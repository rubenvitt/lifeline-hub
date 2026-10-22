//! Ziel eines Auftrags mit Koordinate (LLH-1114, Spec `ortsfeld`, „Ziel eines Auftrags“): `ort`
//! mit `ort_lat`/`ort_lon`, Paar und Textbindung am Server (422), Berichtigung des Punkts im ETB.
use axum::http::StatusCode;
use serde_json::{json, Value};

mod common;
use common::{anfrage, einsatz_anlegen, login_cookie, setup_mit_pool_und_live};

fn funktion(t: &str) -> Value {
    json!({ "empfaenger_typ": "funktion", "funktion_text": t })
}

async fn erteilen(app: &axum::Router, cookie: &str, e: i64, extra: Value) -> (StatusCode, Value) {
    let mut body = json!({
        "auftrag_text": "Sandsäcke zum Deich bringen",
        "empfaenger": [funktion("Logistiktrupp")]
    });
    body.as_object_mut()
        .unwrap()
        .extend(extra.as_object().unwrap().clone());
    anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{e}/auftraege"),
        cookie,
        Some(&body.to_string()),
    )
    .await
}

async fn patch(
    app: &axum::Router,
    cookie: &str,
    e: i64,
    aid: i64,
    body: Value,
) -> (StatusCode, Value) {
    anfrage(
        app,
        "PATCH",
        &format!("/api/einsaetze/{e}/auftraege/{aid}"),
        cookie,
        Some(&body.to_string()),
    )
    .await
}

async fn anordnungen(app: &axum::Router, cookie: &str, e: i64) -> Vec<String> {
    let (_, etb) = anfrage(app, "GET", &format!("/api/einsaetze/{e}/etb"), cookie, None).await;
    etb.as_array()
        .unwrap()
        .iter()
        .filter(|x| x["typ"] == "anordnung")
        .map(|x| x["inhalt"].as_str().unwrap().to_string())
        .collect()
}

fn hat(v: &Value, feld: &str) -> bool {
    v.as_object().unwrap().contains_key(feld)
}

#[tokio::test]
async fn erteilen_speichert_ziel_mit_koordinate_ohne_bleibt_sie_weg() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;

    let (s, j) = erteilen(
        &app,
        &admin,
        e,
        json!({ "ort": "Deich Nord, km 3", "ort_lat": 53.08, "ort_lon": 8.81 }),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{j}");
    assert_eq!(j["ort"], "Deich Nord, km 3");
    assert_eq!(
        (j["ort_lat"].as_f64(), j["ort_lon"].as_f64()),
        (Some(53.08), Some(8.81))
    );
    let aid = j["id"].as_i64().unwrap();
    let (s, d) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/auftraege/{aid}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{d}");
    assert_eq!(d["ort_lat"].as_f64(), Some(53.08));

    // Ohne Koordinate fehlen beide Felder (LFH-265: absent statt null).
    let (s, j) = erteilen(&app, &admin, e, json!({ "ort": "Deich Süd" })).await;
    assert_eq!(s, StatusCode::CREATED, "{j}");
    assert!(!hat(&j, "ort_lat") && !hat(&j, "ort_lon"), "{j}");
}

#[tokio::test]
async fn halbes_paar_ausserhalb_oder_ohne_text_ist_422() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;

    for extra in [
        json!({ "ort": "Deich", "ort_lat": 53.0 }),
        json!({ "ort": "Deich", "ort_lat": 91.0, "ort_lon": 8.0 }),
        json!({ "ort_lat": 53.0, "ort_lon": 8.0 }),
        json!({ "ort": "  ", "ort_lat": 53.0, "ort_lon": 8.0 }),
    ] {
        let (s, j) = erteilen(&app, &admin, e, extra.clone()).await;
        assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{extra}: {j}");
    }

    let (_, j) = erteilen(&app, &admin, e, json!({ "ort": "Deich" })).await;
    let aid = j["id"].as_i64().unwrap();
    for body in [
        json!({ "ort_lat": 53.0 }),
        json!({ "ort_lon": 181.0, "ort_lat": 53.0 }),
        json!({ "ort": null, "ort_lat": 53.0, "ort_lon": 8.0 }),
    ] {
        let (s, j) = patch(&app, &admin, e, aid, body.clone()).await;
        assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{body}: {j}");
    }
    assert_eq!(
        anordnungen(&app, &admin, e)
            .await
            .iter()
            .filter(|a| a.contains("geändert"))
            .count(),
        0
    );
}

#[tokio::test]
async fn punkt_berichtigen_nennt_ziel_ort_im_etb_einmal() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (_, j) = erteilen(
        &app,
        &admin,
        e,
        json!({ "ort": "Deich Nord", "ort_lat": 53.08, "ort_lon": 8.81 }),
    )
    .await;
    let aid = j["id"].as_i64().unwrap();

    // Nur der Punkt.
    let (s, j) = patch(
        &app,
        &admin,
        e,
        aid,
        json!({ "ort_lat": 53.09, "ort_lon": 8.82 }),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{j}");
    assert_eq!(j["ort"], "Deich Nord");
    assert_eq!(
        (j["ort_lat"].as_f64(), j["ort_lon"].as_f64()),
        (Some(53.09), Some(8.82))
    );
    // Text und Punkt zusammen: „Ziel/Ort“ steht einmal.
    let (s, j) = patch(
        &app,
        &admin,
        e,
        aid,
        json!({ "ort": "Deich Nord, km 4", "ort_lat": 53.1, "ort_lon": 8.83 }),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{j}");
    // Derselbe Punkt noch einmal: keine Änderung.
    let (s, _) = patch(
        &app,
        &admin,
        e,
        aid,
        json!({ "ort_lat": 53.1, "ort_lon": 8.83 }),
    )
    .await;
    assert_eq!(s, StatusCode::OK);

    let geaendert: Vec<String> = anordnungen(&app, &admin, e)
        .await
        .into_iter()
        .filter(|a| a.contains("geändert"))
        .collect();
    assert_eq!(
        geaendert,
        vec![
            "Auftrag #1 geändert: Ziel/Ort.".to_string(),
            "Auftrag #1 geändert: Ziel/Ort.".to_string()
        ]
    );
}

#[tokio::test]
async fn ziel_leeren_leert_den_punkt_punkt_entfernen_laesst_den_text() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let mit = json!({ "ort": "Deich Nord", "ort_lat": 53.08, "ort_lon": 8.81 });

    let (_, j) = erteilen(&app, &admin, e, mit.clone()).await;
    let aid = j["id"].as_i64().unwrap();
    let (s, j) = patch(
        &app,
        &admin,
        e,
        aid,
        json!({ "ort_lat": null, "ort_lon": null }),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{j}");
    assert_eq!(j["ort"], "Deich Nord");
    assert!(!hat(&j, "ort_lat") && !hat(&j, "ort_lon"), "{j}");

    let (_, j) = erteilen(&app, &admin, e, mit).await;
    let aid = j["id"].as_i64().unwrap();
    let (s, j) = patch(&app, &admin, e, aid, json!({ "ort": null })).await;
    assert_eq!(s, StatusCode::OK, "{j}");
    assert!(j["ort"].is_null());
    assert!(
        !hat(&j, "ort_lat") && !hat(&j, "ort_lon"),
        "der Punkt hängt am Text: {j}"
    );
}
