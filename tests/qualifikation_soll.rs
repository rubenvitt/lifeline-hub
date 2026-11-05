//! LLH-1553 (Change `z14dre9r-qualifikationsstufen-soll`, Spec `qualifikationen`): „Schließt ein“
//! im Katalog und Qualifikationssoll an Einheitentyp, Einheit und UHS über die Routen.

use axum::http::StatusCode;
use serde_json::{json, Value};

mod common;
use common::*;

async fn katalog(app: &axum::Router, cookie: &str) -> Vec<Value> {
    let (s, json) = anfrage(app, "GET", "/api/qualifikationen", cookie, None).await;
    assert_eq!(s, StatusCode::OK);
    json.as_array().unwrap().clone()
}

fn id_von(katalog: &[Value], label: &str) -> i64 {
    katalog
        .iter()
        .find(|q| q["label"] == label)
        .unwrap_or_else(|| panic!("{label} fehlt"))["id"]
        .as_i64()
        .unwrap()
}

#[tokio::test]
async fn startliste_bringt_ketten_und_kreis_ist_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let k = katalog(&app, &admin).await;
    let san = id_von(&k, "Sanitäter");
    let rs = id_von(&k, "Rettungssanitäter");
    let ns = id_von(&k, "Notfallsanitäter");
    let na = id_von(&k, "Notarzt");
    let ein =
        |label: &str| k.iter().find(|q| q["label"] == label).unwrap()["schliesst_ein_id"].clone();
    assert_eq!(ein("Notfallsanitäter"), json!(rs));
    assert_eq!(ein("Rettungssanitäter"), json!(san));
    assert_eq!(ein("Notarzt"), Value::Null);

    // Kreis: Sanitäter schließt Notfallsanitäter ein, während die Kette besteht.
    let (s, _) = anfrage(
        &app,
        "PATCH",
        &format!("/api/qualifikationen/{san}"),
        &admin,
        Some(&format!(r#"{{"schliesst_ein_id":{ns}}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
    // Nichts geändert.
    let k = katalog(&app, &admin).await;
    assert!(k.iter().find(|q| q["id"] == san).unwrap()["schliesst_ein_id"].is_null());

    // Notarzt kann der Admin verketten und wieder lösen; Nicht-Admin darf es nicht.
    benutzer_anlegen(&app, &admin, "erika", "keine").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;
    let setze = format!(r#"{{"schliesst_ein_id":{ns}}}"#);
    let pfad = format!("/api/qualifikationen/{na}");
    assert_eq!(
        anfrage(&app, "PATCH", &pfad, &erika, Some(&setze)).await.0,
        StatusCode::FORBIDDEN
    );
    let (s, json) = anfrage(&app, "PATCH", &pfad, &admin, Some(&setze)).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(json["schliesst_ein_id"], ns);
    let (s, json) = anfrage(
        &app,
        "PATCH",
        &pfad,
        &admin,
        Some(r#"{"schliesst_ein_id":null}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert!(json["schliesst_ein_id"].is_null());

    // Neu mit Einschluss; unbekannte Qualifikation ist 422.
    let (s, json) = anfrage(
        &app,
        "POST",
        "/api/qualifikationen",
        &admin,
        Some(r#"{"label":"Sanitätshelfer","sortier":5,"schliesst_ein_id":null}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    let sanh = json["id"].as_i64().unwrap();
    let (s, _) = anfrage(
        &app,
        "PATCH",
        &format!("/api/qualifikationen/{san}"),
        &admin,
        Some(&format!(r#"{{"schliesst_ein_id":{sanh}}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "Sanitäter schließt Sanitätshelfer ein");
    let (s, _) = anfrage(
        &app,
        "POST",
        "/api/qualifikationen",
        &admin,
        Some(r#"{"label":"X","schliesst_ein_id":987654}"#),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn qualifikationssoll_an_typ_einheit_und_uhs() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let k = katalog(&app, &admin).await;
    let san = id_von(&k, "Sanitäter");
    let rs = id_von(&k, "Rettungssanitäter");

    // Einheitentyp: Dublette 400, unbekannte Qualifikation 422, leere Liste = kein Soll.
    let (s, _) = anfrage(
        &app,
        "POST",
        "/api/einheit-typen",
        &admin,
        Some(&format!(
            r#"{{"label":"RTW","quali_soll":[{{"qualifikation_id":{rs},"anzahl":1}},{{"qualifikation_id":{rs},"anzahl":1}}]}}"#
        )),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    let (s, _) = anfrage(
        &app,
        "POST",
        "/api/einheit-typen",
        &admin,
        Some(r#"{"label":"RTW","quali_soll":[{"qualifikation_id":987654,"anzahl":1}]}"#),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
    let (s, typ) = anfrage(
        &app,
        "POST",
        "/api/einheit-typen",
        &admin,
        Some(&format!(
            r#"{{"label":"RTW","soll_fuehrer":0,"soll_unterfuehrer":0,"soll_mannschaft":2,"quali_soll":[{{"qualifikation_id":{rs},"anzahl":1}}]}}"#
        )),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{typ:?}");
    assert_eq!(
        typ["quali_soll"],
        json!([{"qualifikation_id": rs, "label": "Rettungssanitäter", "anzahl": 1}])
    );
    let typ_id = typ["id"].as_i64().unwrap();

    // Einheit: erbt vom Typ, eigener Wert gewinnt, `[]` erbt wieder.
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (s, einheit) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/einheiten"),
        &admin,
        Some(&format!(r#"{{"name":"RTW 1","typ_id":{typ_id}}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{einheit:?}");
    assert_eq!(einheit["quali_soll_eigen"], false);
    assert_eq!(einheit["quali_soll"][0]["label"], "Rettungssanitäter");
    let eid = einheit["id"].as_i64().unwrap();
    let pfad = format!("/api/einsaetze/{einsatz}/einheiten/{eid}");
    let (s, json) = anfrage(
        &app,
        "PATCH",
        &pfad,
        &admin,
        Some(&format!(
            r#"{{"quali_soll":[{{"qualifikation_id":{san},"anzahl":2}}]}}"#
        )),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{json:?}");
    assert_eq!(json["quali_soll_eigen"], true);
    assert_eq!(json["quali_soll"][0]["anzahl"], 2);
    let (s, json) = anfrage(&app, "PATCH", &pfad, &admin, Some(r#"{"quali_soll":[]}"#)).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(json["quali_soll_eigen"], false);
    assert_eq!(json["quali_soll"][0]["label"], "Rettungssanitäter");

    // UHS: Soll-Anzahl und Qualifikationssoll, Grenzen 400.
    let (s, uhs) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/uhs"),
        &admin,
        Some(r#"{"typ":"behandlungsplatz","bezeichnung":"UHS Markt"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    assert!(uhs["soll_anzahl"].is_null());
    assert!(uhs["quali_soll"].is_null());
    let uid = uhs["id"].as_i64().unwrap();
    let pfad = format!("/api/einsaetze/{einsatz}/uhs/{uid}");
    for falsch in [
        r#"{"soll_anzahl":0}"#.to_string(),
        r#"{"soll_anzahl":201}"#.to_string(),
        format!(r#"{{"quali_soll":[{{"qualifikation_id":{san},"anzahl":51}}]}}"#),
    ] {
        assert_eq!(
            anfrage(&app, "PATCH", &pfad, &admin, Some(&falsch)).await.0,
            StatusCode::BAD_REQUEST,
            "{falsch}"
        );
    }
    let (s, json) = anfrage(
        &app,
        "PATCH",
        &pfad,
        &admin,
        Some(&format!(
            r#"{{"soll_anzahl":4,"quali_soll":[{{"qualifikation_id":{rs},"anzahl":1}},{{"qualifikation_id":{san},"anzahl":2}}]}}"#
        )),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{json:?}");
    assert_eq!(json["soll_anzahl"], 4);
    assert_eq!(json["quali_soll"][1]["label"], "Sanitäter");
    // Ein PATCH ohne Soll lässt es stehen.
    let (s, json) = anfrage(&app, "PATCH", &pfad, &admin, Some(r#"{"notiz":"Zelt 2"}"#)).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(json["soll_anzahl"], 4);
    assert_eq!(json["quali_soll"].as_array().unwrap().len(), 2);
    let (s, json) = anfrage(
        &app,
        "PATCH",
        &pfad,
        &admin,
        Some(r#"{"soll_anzahl":null,"quali_soll":null}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert!(json["soll_anzahl"].is_null());
    assert!(json["quali_soll"].is_null());
}
