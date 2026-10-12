//! LFH-1194: Katalog „Externe Stellen“ über HTTP — Rechte, Statuscodes und Org-Grenze
//! (Spec `stammdaten-externe-stellen`). Die Regeln der Markierung „zuständig“ prüfen die
//! Repo-Tests in `src/externe_stelle/tests.rs`; hier nur ihr Statuscode.

use axum::http::StatusCode;
use serde_json::Value;

mod common;
use common::{anfrage, benutzer_anlegen, fremde_org_anlegen, login_cookie, setup, setup_mit_pool};

const PFAD: &str = "/api/externe-stellen";

async fn create_stelle(app: &axum::Router, cookie: &str, rumpf: &str) -> (StatusCode, Value) {
    anfrage(app, "POST", PFAD, cookie, Some(rumpf)).await
}

async fn update_stelle(
    app: &axum::Router,
    cookie: &str,
    id: i64,
    rumpf: &str,
) -> (StatusCode, Value) {
    anfrage(app, "PATCH", &format!("{PFAD}/{id}"), cookie, Some(rumpf)).await
}

fn bezeichnungen(json: &Value) -> Vec<String> {
    json.as_array()
        .unwrap()
        .iter()
        .map(|s| s["bezeichnung"].as_str().unwrap().to_string())
        .collect()
}

#[tokio::test]
async fn admin_legt_leitstelle_an_aktiv_und_nicht_zustaendig() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (status, json) = create_stelle(
        &app,
        &admin,
        r#"{"bezeichnung":"  ILS Musterkreis ","art":"leitstelle","rufnummer":"112"}"#,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{json}");
    assert_eq!(json["bezeichnung"], "ILS Musterkreis");
    assert_eq!(json["art"], "leitstelle");
    assert_eq!(json["rufnummer"], "112");
    assert!(json.get("funkrufname").is_none(), "leer wird weggelassen");
    assert_eq!(json["aktiv"], true);
    assert_eq!(json["zustaendig"], false);
}

#[tokio::test]
async fn eingaben_werden_geprueft() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let lang = "x".repeat(201);
    for rumpf in [
        r#"{"bezeichnung":"  ","art":"polizei"}"#.to_string(),
        r#"{"bezeichnung":"Feuerwehr","art":"feuerwehr"}"#.to_string(),
        format!(r#"{{"bezeichnung":"{lang}","art":"polizei"}}"#),
        format!(
            r#"{{"bezeichnung":"P","art":"polizei","rufnummer":"{}"}}"#,
            "1".repeat(101)
        ),
    ] {
        let (status, json) = create_stelle(&app, &admin, &rumpf).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{rumpf}: {json}");
    }
    let (_, json) = create_stelle(
        &app,
        &admin,
        &format!(r#"{{"bezeichnung":"{lang}","art":"polizei"}}"#),
    )
    .await;
    let meldung = json.to_string();
    assert!(
        meldung.contains("Bezeichnung") && meldung.contains("200"),
        "{meldung}"
    );

    let genau = "ä".repeat(200);
    let (status, _) = create_stelle(
        &app,
        &admin,
        &format!(r#"{{"bezeichnung":"{genau}","art":"polizei"}}"#),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    let (status, _) =
        create_stelle(&app, &admin, r#"{"bezeichnung":"Polizei","art":"polizei"}"#).await;
    assert_eq!(status, StatusCode::CREATED);
    let (status, _) = create_stelle(
        &app,
        &admin,
        r#"{"bezeichnung":"Polizei","art":"sonstige"}"#,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
}

#[tokio::test]
async fn ohne_admin_recht_403_aber_lesen_geht_nur_aktive() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "erika", "keine").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;

    let (status, _) = create_stelle(&app, &erika, r#"{"bezeichnung":"X","art":"polizei"}"#).await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (_, amt) = create_stelle(
        &app,
        &admin,
        r#"{"bezeichnung":"Ordnungsamt","art":"behoerde"}"#,
    )
    .await;
    create_stelle(&app, &admin, r#"{"bezeichnung":"Polizei","art":"polizei"}"#).await;
    let amt = amt["id"].as_i64().unwrap();
    let (status, _) = update_stelle(&app, &erika, amt, r#"{"aktiv":false}"#).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = update_stelle(&app, &admin, amt, r#"{"aktiv":false}"#).await;
    assert_eq!(status, StatusCode::OK);

    let (status, json) = anfrage(&app, "GET", PFAD, &erika, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(bezeichnungen(&json), ["Polizei"]);

    let (_, json) = anfrage(
        &app,
        "GET",
        &format!("{PFAD}?nur_aktive=false"),
        &admin,
        None,
    )
    .await;
    assert_eq!(bezeichnungen(&json), ["Polizei", "Ordnungsamt"]);
    assert_eq!(json[1]["aktiv"], false);

    // Reaktivieren.
    let (status, json) = update_stelle(&app, &admin, amt, r#"{"aktiv":true}"#).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["aktiv"], true);
    let (_, json) = anfrage(&app, "GET", PFAD, &erika, None).await;
    assert_eq!(bezeichnungen(&json).len(), 2);
}

#[tokio::test]
async fn kein_loeschen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) =
        create_stelle(&app, &admin, r#"{"bezeichnung":"Polizei","art":"polizei"}"#).await;
    let id = json["id"].as_i64().unwrap();
    let (status, _) = anfrage(&app, "DELETE", &format!("{PFAD}/{id}"), &admin, None).await;
    assert_eq!(status, StatusCode::METHOD_NOT_ALLOWED);
}

#[tokio::test]
async fn zustaendige_leitstelle_wechselt_und_422_bei_anderer_art() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, nord) = create_stelle(
        &app,
        &admin,
        r#"{"bezeichnung":"ILS Nord","art":"leitstelle","zustaendig":true}"#,
    )
    .await;
    let (_, sued) = create_stelle(
        &app,
        &admin,
        r#"{"bezeichnung":"ILS Süd","art":"leitstelle"}"#,
    )
    .await;
    let (_, polizei) =
        create_stelle(&app, &admin, r#"{"bezeichnung":"Polizei","art":"polizei"}"#).await;
    assert_eq!(nord["zustaendig"], true);

    let (status, json) = update_stelle(
        &app,
        &admin,
        sued["id"].as_i64().unwrap(),
        r#"{"zustaendig":true}"#,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["zustaendig"], true);
    let (_, liste) = anfrage(&app, "GET", PFAD, &admin, None).await;
    let zustaendige: Vec<&str> = liste
        .as_array()
        .unwrap()
        .iter()
        .filter(|s| s["zustaendig"] == true)
        .map(|s| s["bezeichnung"].as_str().unwrap())
        .collect();
    assert_eq!(zustaendige, ["ILS Süd"]);
    assert_eq!(liste[0]["bezeichnung"], "ILS Süd", "zuständige vorn");

    let (status, _) = update_stelle(
        &app,
        &admin,
        polizei["id"].as_i64().unwrap(),
        r#"{"zustaendig":true}"#,
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let (status, _) = update_stelle(
        &app,
        &admin,
        sued["id"].as_i64().unwrap(),
        r#"{"art":"behoerde"}"#,
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let (status, _) = create_stelle(
        &app,
        &admin,
        r#"{"bezeichnung":"Amt","art":"behoerde","zustaendig":true}"#,
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn org_grenze_liste_und_patch() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) =
        create_stelle(&app, &admin, r#"{"bezeichnung":"Polizei","art":"polizei"}"#).await;
    let id_a = json["id"].as_i64().unwrap();

    let (org_b, _) = fremde_org_anlegen(&pool, "Org B", "bert", "bertpw123", "keine").await;
    let bert = login_cookie(&app, "bert", "bertpw123").await;
    let (status, json) = anfrage(&app, "GET", PFAD, &bert, None).await;
    assert_eq!(status, StatusCode::OK);
    assert!(json.as_array().unwrap().is_empty(), "{json}");

    // Die Stelle von Org B (gleicher Name erlaubt) bleibt für den Admin von Org A unerreichbar.
    let id_b = lifeline_hub::externe_stelle::repo::create(
        &pool,
        org_b,
        lifeline_hub::externe_stelle::repo::NeueStelle {
            bezeichnung: "Polizei",
            art: lifeline_hub::externe_stelle::ExterneStelleArt::Polizei,
            rufnummer: None,
            funkrufname: None,
            zustaendig: false,
        },
    )
    .await
    .unwrap()
    .id;
    assert_ne!(id_a, id_b);
    let (status, _) = update_stelle(&app, &admin, id_b, r#"{"bezeichnung":"fremd"}"#).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let b = lifeline_hub::externe_stelle::repo::load(&pool, org_b, id_b)
        .await
        .unwrap();
    assert_eq!(b.bezeichnung, "Polizei");
}

#[tokio::test]
async fn patch_prueft_eingaben_und_leert_mit_null_oder_leer() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = create_stelle(
        &app,
        &admin,
        r#"{"bezeichnung":"ILS","art":"leitstelle","rufnummer":"112","funkrufname":"Leitstelle"}"#,
    )
    .await;
    let id = json["id"].as_i64().unwrap();

    for rumpf in [
        r#"{"bezeichnung":"  "}"#.to_string(),
        format!(r#"{{"bezeichnung":"{}"}}"#, "x".repeat(201)),
        r#"{"art":"feuerwehr"}"#.to_string(),
        format!(r#"{{"rufnummer":"{}"}}"#, "1".repeat(101)),
        format!(r#"{{"funkrufname":"{}"}}"#, "f".repeat(101)),
    ] {
        let (status, json) = update_stelle(&app, &admin, id, &rumpf).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{rumpf}: {json}");
    }
    let (status, json) = create_stelle(
        &app,
        &admin,
        &format!(
            r#"{{"bezeichnung":"P","art":"polizei","funkrufname":"{}"}}"#,
            "f".repeat(101)
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{json}");

    let (status, json) =
        update_stelle(&app, &admin, id, r#"{"rufnummer":"  ","funkrufname":null}"#).await;
    assert_eq!(status, StatusCode::OK, "{json}");
    assert!(json.get("rufnummer").is_none(), "leer leert: {json}");
    assert!(json.get("funkrufname").is_none(), "null leert: {json}");
    assert_eq!(json["bezeichnung"], "ILS");
}
