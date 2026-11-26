//! LLH-2093: Kanaladressen der externen Stellen über HTTP — Rechte, Statuscodes, Org-Grenze.

use axum::http::StatusCode;
use serde_json::Value;

mod common;
use common::{anfrage, benutzer_anlegen, fremde_org_anlegen, login_cookie, setup, setup_mit_pool};

const PFAD: &str = "/api/external-agencies";

async fn stelle_anlegen(app: &axum::Router, cookie: &str, name: &str) -> i64 {
    let rumpf = format!(r#"{{"bezeichnung":"{name}","art":"behoerde"}}"#);
    let (status, json) = anfrage(app, "POST", PFAD, cookie, Some(&rumpf)).await;
    assert_eq!(status, StatusCode::CREATED, "{json}");
    json["id"].as_i64().unwrap()
}

async fn kanal_anlegen(
    app: &axum::Router,
    cookie: &str,
    stelle: i64,
    rumpf: &str,
) -> (StatusCode, Value) {
    anfrage(
        app,
        "POST",
        &format!("{PFAD}/{stelle}/channels"),
        cookie,
        Some(rumpf),
    )
    .await
}

#[tokio::test]
async fn admin_legt_mailadresse_an_und_liest_sie() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let stelle = stelle_anlegen(&app, &admin, "Kreisverwaltung").await;
    let (status, json) = kanal_anlegen(
        &app,
        &admin,
        stelle,
        r#"{"channel":"email","address":" Lage@Kreis-Nord.de ","label":" Einsatzpostfach "}"#,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{json}");
    assert_eq!(json["channel"], "email");
    assert_eq!(json["address"], "Lage@kreis-nord.de");
    assert_eq!(json["label"], "Einsatzpostfach");
    assert_eq!(json["externe_stelle_id"], stelle);

    let (status, liste) = anfrage(
        &app,
        "GET",
        &format!("{PFAD}/{stelle}/channels"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(liste.as_array().unwrap().len(), 1);
    assert_eq!(liste[0]["address"], "Lage@kreis-nord.de");

    let kanal_id = json["id"].as_i64().unwrap();
    let (status, geaendert) = anfrage(
        &app,
        "PATCH",
        &format!("{PFAD}/{stelle}/channels/{kanal_id}"),
        &admin,
        Some(r#"{"address":"neu@kreis-nord.de","label":null}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{geaendert}");
    assert_eq!(geaendert["address"], "neu@kreis-nord.de");
    assert!(geaendert.get("label").is_none());

    let (status, _) = anfrage(
        &app,
        "DELETE",
        &format!("{PFAD}/{stelle}/channels/{kanal_id}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (_, liste) = anfrage(
        &app,
        "GET",
        &format!("{PFAD}/{stelle}/channels"),
        &admin,
        None,
    )
    .await;
    assert!(liste.as_array().unwrap().is_empty());
}

#[tokio::test]
async fn sammelroute_liefert_je_kanal_nur_dessen_adressen_aktiver_stellen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let aktiv = stelle_anlegen(&app, &admin, "Aktiv").await;
    let inaktiv = stelle_anlegen(&app, &admin, "Inaktiv").await;
    for s in [aktiv, inaktiv] {
        let (status, _) =
            kanal_anlegen(&app, &admin, s, r#"{"channel":"email","address":"a@b.de"}"#).await;
        assert_eq!(status, StatusCode::CREATED);
    }
    let (status, _) = anfrage(
        &app,
        "PATCH",
        &format!("{PFAD}/{inaktiv}"),
        &admin,
        Some(r#"{"aktiv":false}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, json) = anfrage(
        &app,
        "GET",
        &format!("{PFAD}/channels?channel=email"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json}");
    let liste = json.as_array().unwrap();
    assert_eq!(liste.len(), 1, "{json}");
    assert_eq!(liste[0]["agency_id"], aktiv);
    assert_eq!(liste[0]["agency_name"], "Aktiv");
    assert_eq!(liste[0]["channel"]["address"], "a@b.de");

    let (status, json) = kanal_anlegen(
        &app,
        &admin,
        aktiv,
        r#"{"channel":"fax","address":"0511 123456"}"#,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{json}");
    let (status, json) = anfrage(
        &app,
        "GET",
        &format!("{PFAD}/channels?channel=fax"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json}");
    let liste = json.as_array().unwrap();
    assert_eq!(liste.len(), 1, "{json}");
    assert_eq!(liste[0]["channel"]["address"], "+49511123456");
    assert_eq!(liste[0]["channel"]["channel"], "fax");

    let (status, _) = anfrage(
        &app,
        "GET",
        &format!("{PFAD}/channels?channel=threema"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn faxnummer_wird_normalisiert_und_ungueltige_abgelehnt() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let stelle = stelle_anlegen(&app, &admin, "Leitstelle").await;
    let (status, json) = kanal_anlegen(
        &app,
        &admin,
        stelle,
        r#"{"channel":"fax","address":"+49 (0) 511 / 123 45-6"}"#,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{json}");
    assert_eq!(json["address"], "+49511123456");
    let (status, json) = kanal_anlegen(
        &app,
        &admin,
        stelle,
        r#"{"channel":"fax","address":"Leitstelle anrufen"}"#,
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{json}");
}

#[tokio::test]
async fn threema_ist_noch_nicht_freigeschaltet() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let stelle = stelle_anlegen(&app, &admin, "Kreisverwaltung").await;
    for kanal in ["threema", "brieftaube"] {
        let (status, json) = kanal_anlegen(
            &app,
            &admin,
            stelle,
            &format!(r#"{{"channel":"{kanal}","address":"0123"}}"#),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{kanal}: {json}");
    }
    let (status, _) = kanal_anlegen(
        &app,
        &admin,
        stelle,
        r#"{"channel":"email","address":"a@b.de, c@d.de"}"#,
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn kein_admin_darf_nicht_schreiben() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let stelle = stelle_anlegen(&app, &admin, "Kreisverwaltung").await;
    let (_, json) = kanal_anlegen(
        &app,
        &admin,
        stelle,
        r#"{"channel":"email","address":"a@b.de"}"#,
    )
    .await;
    let kanal_id = json["id"].as_i64().unwrap();
    benutzer_anlegen(&app, &admin, "erika", "keine").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;

    let (status, _) = kanal_anlegen(
        &app,
        &erika,
        stelle,
        r#"{"channel":"email","address":"x@y.de"}"#,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = anfrage(
        &app,
        "PATCH",
        &format!("{PFAD}/{stelle}/channels/{kanal_id}"),
        &erika,
        Some(r#"{"address":"x@y.de"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = anfrage(
        &app,
        "DELETE",
        &format!("{PFAD}/{stelle}/channels/{kanal_id}"),
        &erika,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    // Lesen darf jeder der Org.
    let (status, liste) = anfrage(
        &app,
        "GET",
        &format!("{PFAD}/{stelle}/channels"),
        &erika,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(liste.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn fremde_org_sieht_404() {
    use lifeline_hub::externe_stelle::kanal;
    use lifeline_hub::externe_stelle::repo::{self, NeueStelle};
    use lifeline_hub::externe_stelle::{ExterneStelleArt, KanalArt};

    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let stelle_a = stelle_anlegen(&app, &admin, "Kreisverwaltung").await;
    let (_, json) = kanal_anlegen(
        &app,
        &admin,
        stelle_a,
        r#"{"channel":"email","address":"a@b.de"}"#,
    )
    .await;
    let kanal_a = json["id"].as_i64().unwrap();

    let (org_b, _) = fremde_org_anlegen(&pool, "Org B", "bert", "bertpw123", "keine").await;
    let stelle_b = repo::create(
        &pool,
        org_b,
        NeueStelle {
            bezeichnung: "Polizei B",
            art: ExterneStelleArt::Polizei,
            rufnummer: None,
            funkrufname: None,
            zustaendig: false,
        },
    )
    .await
    .unwrap()
    .id;
    let kanal_b = kanal::create(&pool, org_b, stelle_b, KanalArt::Email, "b@b.de", None)
        .await
        .unwrap()
        .id;

    // Der Admin von Org A erreicht die Stelle und die Adresse von Org B nicht.
    let (status, _) = anfrage(
        &app,
        "GET",
        &format!("{PFAD}/{stelle_b}/channels"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = kanal_anlegen(
        &app,
        &admin,
        stelle_b,
        r#"{"channel":"email","address":"x@y.de"}"#,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = anfrage(
        &app,
        "PATCH",
        &format!("{PFAD}/{stelle_b}/channels/{kanal_b}"),
        &admin,
        Some(r#"{"address":"x@y.de"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = anfrage(
        &app,
        "DELETE",
        &format!("{PFAD}/{stelle_b}/channels/{kanal_b}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    // Eine Adresse der eigenen Org unter der Stelle einer anderen Org: ebenfalls 404.
    let (status, _) = anfrage(
        &app,
        "DELETE",
        &format!("{PFAD}/{stelle_b}/channels/{kanal_a}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // Org B sieht die Stelle von Org A nicht, und die Sammelroute zeigt nur die eigene Adresse.
    let bert = login_cookie(&app, "bert", "bertpw123").await;
    let (status, _) = anfrage(
        &app,
        "GET",
        &format!("{PFAD}/{stelle_a}/channels"),
        &bert,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (_, json) = anfrage(
        &app,
        "GET",
        &format!("{PFAD}/channels?channel=email"),
        &bert,
        None,
    )
    .await;
    let liste = json.as_array().unwrap();
    assert_eq!(liste.len(), 1, "{json}");
    assert_eq!(liste[0]["channel"]["address"], "b@b.de");
}

#[tokio::test]
async fn doppelte_adresse_ist_409() {
    // Konvention des Repos für eine UNIQUE-Verletzung im Katalog (wie die doppelte Bezeichnung
    // einer Stelle): 409.
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let stelle = stelle_anlegen(&app, &admin, "Kreisverwaltung").await;
    let rumpf = r#"{"channel":"email","address":"a@b.de"}"#;
    let (status, _) = kanal_anlegen(&app, &admin, stelle, rumpf).await;
    assert_eq!(status, StatusCode::CREATED);
    let (status, json) = kanal_anlegen(&app, &admin, stelle, rumpf).await;
    assert_eq!(status, StatusCode::CONFLICT, "{json}");
    // Gleiche Adresse mit anderer Schreibweise der Domain ist dieselbe.
    let (status, _) = kanal_anlegen(
        &app,
        &admin,
        stelle,
        r#"{"channel":"email","address":"a@B.DE"}"#,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
}

#[tokio::test]
async fn post_matrix_kanal_legt_an_und_sammlung_liefert_beide_kanaele() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let stelle = stelle_anlegen(&app, &admin, "Leitstelle Nord").await;
    let (status, json) = kanal_anlegen(
        &app,
        &admin,
        stelle,
        r#"{"channel":"matrix","address":" #lage:example.org "}"#,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{json}");
    assert_eq!(json["channel"], "matrix");
    assert_eq!(json["address"], "#lage:example.org");
    let (status, _) = kanal_anlegen(
        &app,
        &admin,
        stelle,
        r#"{"channel":"email","address":"a@b.de"}"#,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let (status, json) = kanal_anlegen(
        &app,
        &admin,
        stelle,
        r#"{"channel":"matrix","address":"@bot:example.org"}"#,
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{json}");

    let (status, json) = anfrage(&app, "GET", &format!("{PFAD}/channels"), &admin, None).await;
    assert_eq!(status, StatusCode::OK, "{json}");
    let kanaele: Vec<&str> = json
        .as_array()
        .unwrap()
        .iter()
        .map(|k| k["channel"]["channel"].as_str().unwrap())
        .collect();
    assert_eq!(kanaele.len(), 2, "{json}");
    assert!(kanaele.contains(&"email") && kanaele.contains(&"matrix"));

    let (status, json) = anfrage(
        &app,
        "GET",
        &format!("{PFAD}/channels?channel=matrix"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json}");
    assert_eq!(json.as_array().unwrap().len(), 1, "{json}");
    assert_eq!(json[0]["channel"]["address"], "#lage:example.org");
}
