//! Integrationstests „Planung übernehmen“ (LLH-1587, Spec `vorplanung`, „Übernahme in einen
//! Einsatz“): die Demo-Planung Stadtfest in einen neuen Einsatz, eine eigene Planung in einen
//! laufenden Einsatz, Vorschau ohne Schreiben, Schreibschutz danach (409), Rechte und Ziele.
//! Den Abgleich selbst prüft der Übernahme-Kern (`abloesung::schichtplan::uebernahme`).

use axum::http::StatusCode;
use lifeline_hub::app::RouterOptionen;
use serde_json::{json, Value};

mod common;
use common::*;

const PFAD: &str = "/api/planungen";

const AN: RouterOptionen = RouterOptionen {
    demo_daten: true,
    zulassungs_budget: None,
    heic_decoder_verzeichnis: None,
};

async fn admin(app: &axum::Router) -> String {
    login_cookie(app, "admin", "startpw12").await
}

async fn post(app: &axum::Router, cookie: &str, pfad: &str, body: Value) -> (StatusCode, Value) {
    anfrage_json(app, "POST", pfad, cookie, Some(&body)).await
}

async fn get(app: &axum::Router, cookie: &str, pfad: &str) -> Value {
    let (s, v) = anfrage(app, "GET", pfad, cookie, None).await;
    assert_eq!(s, StatusCode::OK, "{pfad}: {v}");
    v
}

async fn einsatz_anzahl(app: &axum::Router, cookie: &str) -> usize {
    get(app, cookie, "/api/einsaetze")
        .await
        .as_array()
        .unwrap()
        .len()
}

/// Importiert die Lage Stadtfest und liefert die Kennung der Demo-Planung.
async fn stadtfest_planung(app: &axum::Router, admin: &str) -> i64 {
    let (s, v) = anfrage(app, "POST", "/api/demo-daten/stadtfest", admin, None).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    get(app, admin, PFAD)
        .await
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["bezeichnung"] == "Stadtfest Musterstadt")
        .expect("Demo-Planung")["id"]
        .as_i64()
        .unwrap()
}

/// Eine kleine Planung mit einem Posten, einem Block, einer Stamm-Person und einem Helfer.
async fn kleine_planung(app: &axum::Router, cookie: &str, name: &str) -> (i64, i64) {
    let mia = stammpersonal_anlegen(app, cookie, "Mia Muster").await;
    let (s, plan) = post(
        app,
        cookie,
        PFAD,
        json!({"bezeichnung": name, "von": "2027-03-13 08:00:00", "bis": "2027-03-13 23:00:00"}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{plan}");
    let p = plan["kopf"]["id"].as_i64().unwrap();
    let (s, helfer) = post(
        app,
        cookie,
        &format!("{PFAD}/{p}/helfer"),
        json!({"name": "Nora Exempel", "telefon": "0170 1234567", "organisation": "Helferkreis"}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{helfer}");
    let nora = helfer["id"].as_i64().unwrap();
    let (s, plan) = post(
        app,
        cookie,
        &format!("{PFAD}/{p}/posten"),
        json!({"bezeichnung": "Streife 2", "art": "einheit", "soll_anzahl": 2}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{plan}");
    let posten = plan["posten"][0]["id"].as_i64().unwrap();
    let (s, plan) = post(
        app,
        cookie,
        &format!("{PFAD}/{p}/bloecke"),
        json!({"posten_id": posten, "von": "2027-03-13 14:00:00", "bis": "2027-03-13 17:00:00",
               "personen": [{"art": "stamm", "personal_id": mia},
                            {"art": "helfer", "helfer_id": nora}]}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{plan}");
    (p, mia)
}

#[tokio::test]
async fn stadtfest_in_neuen_einsatz_danach_schreibgeschuetzt_und_zweiter_aufruf_409() {
    let (app, _pool) = setup_mit_optionen(AN).await;
    let admin = admin(&app).await;
    let p = stadtfest_planung(&app, &admin).await;
    let vorher = get(&app, &admin, &format!("{PFAD}/{p}")).await;
    let einsaetze = einsatz_anzahl(&app, &admin).await;

    // Die Vorschau legt probehalber an und schreibt nichts.
    let (s, vorschau) = post(
        &app,
        &admin,
        &format!("{PFAD}/{p}/uebernahme/vorschau"),
        json!({"ziel": {"art": "neu"}}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{vorschau}");
    assert_eq!(vorschau["uebernehmbar"], true, "{vorschau}");
    let z = &vorschau["zaehlung"];
    assert_eq!(z["einheiten_neu"], 4, "Streifen, Sanitätswache, KTW: {z}");
    assert_eq!(z["uhs_neu"], 1, "{z}");
    assert_eq!(z["helfer_neu"], 2, "{z}");
    assert_eq!(
        z["bloecke_neu"].as_i64().unwrap(),
        vorher["bloecke"].as_array().unwrap().len() as i64,
        "{z}"
    );
    assert_eq!(
        einsatz_anzahl(&app, &admin).await,
        einsaetze,
        "Vorschau legt keinen Einsatz an"
    );

    let (s, ergebnis) = post(
        &app,
        &admin,
        &format!("{PFAD}/{p}/uebernahme"),
        json!({"ziel": {"art": "neu"}}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{ergebnis}");
    let einsatz = ergebnis["einsatz_id"].as_i64().unwrap();
    assert_eq!(einsatz_anzahl(&app, &admin).await, einsaetze + 1);
    let e = get(&app, &admin, &format!("/api/einsaetze/{einsatz}")).await;
    assert_eq!(e["bezeichnung"], "Stadtfest Musterstadt");
    assert_eq!(e["einsatzart"], vorher["kopf"]["einsatzart"]);
    assert_eq!(e["meine_rolle"], "einsatzleitung");
    let plan = get(
        &app,
        &admin,
        &format!("/api/einsaetze/{einsatz}/abloesungen/schichtplan"),
    )
    .await;
    assert_eq!(
        plan["bloecke"].as_array().unwrap().len(),
        vorher["bloecke"].as_array().unwrap().len(),
        "jeder Block der Planung im Plan des Einsatzes"
    );
    assert!(
        system_etb_inhalte(&app, &admin, einsatz)
            .await
            .iter()
            .any(|t| t.starts_with("Planung „Stadtfest Musterstadt“ übernommen:")),
        "ETB nennt die Planung"
    );

    // Die Planung trägt die Übernahme und ihre Kennzahlen von dann.
    let nachher = ergebnis["planung"].clone();
    let u = &nachher["kopf"]["uebernahme"];
    assert_eq!(u["einsatz_id"], einsatz, "{u}");
    assert_eq!(u["einsatznummer"], e["einsatznummer_intern"], "{u}");
    assert!(u["at"].is_string(), "{u}");
    assert_eq!(nachher["kennzahlen"], vorher["kennzahlen"]);
    let liste = get(&app, &admin, PFAD).await;
    let eintrag = liste
        .as_array()
        .unwrap()
        .iter()
        .find(|x| x["id"] == p)
        .unwrap();
    assert_eq!(eintrag["uebernahme"]["einsatz_id"], einsatz);
    assert_eq!(eintrag["kennzahlen"], vorher["kennzahlen"]);

    // Danach nur lesen und löschen.
    let posten = vorher["posten"][0]["id"].as_i64().unwrap();
    let block = &vorher["bloecke"][0];
    for (methode, pfad, body) in [
        (
            "PATCH",
            format!("{PFAD}/{p}"),
            json!({"version": vorher["kopf"]["version"], "ort": "Anderswo"}),
        ),
        (
            "POST",
            format!("{PFAD}/{p}/posten"),
            json!({"bezeichnung": "Neu", "art": "einheit"}),
        ),
        (
            "PATCH",
            format!("{PFAD}/{p}/posten/{posten}"),
            json!({"bezeichnung": "Umbenannt"}),
        ),
        (
            "PATCH",
            format!("{PFAD}/{p}/bloecke/{}", block["id"]),
            json!({"version": block["version"], "notiz": "x"}),
        ),
        (
            "POST",
            format!("{PFAD}/{p}/helfer"),
            json!({"name": "Spät Dazu"}),
        ),
        (
            "POST",
            format!("{PFAD}/{p}/uebernahme/vorschau"),
            json!({"ziel": {"art": "neu"}}),
        ),
        (
            "POST",
            format!("{PFAD}/{p}/uebernahme"),
            json!({"ziel": {"art": "neu"}}),
        ),
    ] {
        let (s, v) = anfrage_json(&app, methode, &pfad, &admin, Some(&body)).await;
        assert_eq!(s, StatusCode::CONFLICT, "{methode} {pfad}: {v}");
    }
    assert_eq!(
        einsatz_anzahl(&app, &admin).await,
        einsaetze + 1,
        "zweiter Aufruf legt nichts an"
    );
    let (s, _) = anfrage(&app, "DELETE", &format!("{PFAD}/{p}"), &admin, None).await;
    assert_eq!(s, StatusCode::NO_CONTENT, "Löschen bleibt erlaubt");
}

#[tokio::test]
async fn in_laufenden_einsatz_helfer_mit_herkunft_und_bestehende_einheit() {
    let app = setup().await;
    let admin = admin(&app).await;
    let (p, mia) = kleine_planung(&app, &admin, "Konzert").await;
    let einsatz = einsatz_anlegen_mit(&app, &admin, "Konzert").await;
    let streife = einheit_bilden(&app, &admin, einsatz, "Streife 2").await;

    let (s, vorschau) = post(
        &app,
        &admin,
        &format!("{PFAD}/{p}/uebernahme/vorschau"),
        json!({"ziel": {"art": "einsatz", "einsatz_id": einsatz}}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{vorschau}");
    let posten = &vorschau["posten"][0];
    assert_eq!(posten["ziel"]["art"], "einheit", "{posten}");
    assert_eq!(posten["ziel"]["einheit_id"], streife);
    let nora = vorschau["personen"]
        .as_array()
        .unwrap()
        .iter()
        .find(|x| x["name"] == "Nora Exempel")
        .unwrap();
    assert_eq!(nora["ziel"]["art"], "neu", "{nora}");
    assert_eq!(nora["herkunft"], "vorplanung");
    let mia_v = vorschau["personen"]
        .as_array()
        .unwrap()
        .iter()
        .find(|x| x["name"] == "Mia Muster")
        .unwrap();
    assert_eq!(mia_v["ziel"]["personal_id"], mia, "{mia_v}");
    assert_eq!(mia_v["grund"], "bezug");

    let (s, ergebnis) = post(
        &app,
        &admin,
        &format!("{PFAD}/{p}/uebernahme"),
        json!({"ziel": {"art": "einsatz", "einsatz_id": einsatz}}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{ergebnis}");
    assert_eq!(ergebnis["einsatz_id"], einsatz);
    assert_eq!(ergebnis["zaehlung"]["einheiten_neu"], 0);
    assert_eq!(ergebnis["zaehlung"]["helfer_neu"], 1);
    let plan = get(
        &app,
        &admin,
        &format!("/api/einsaetze/{einsatz}/abloesungen/schichtplan"),
    )
    .await;
    let bloecke = plan["bloecke"].as_array().unwrap();
    assert_eq!(bloecke.len(), 1, "{plan}");
    assert_eq!(bloecke[0]["posten"]["einheit_id"], streife, "{plan}");
    assert_eq!(bloecke[0]["personen"].as_array().unwrap().len(), 2);
    let helfer = &plan["helfer"][0];
    assert_eq!(helfer["name"], "Nora Exempel", "{plan}");
    assert_eq!(helfer["herkunft"], "vorplanung", "{plan}");
}

#[tokio::test]
async fn ziel_und_rechte() {
    let (app, pool) = setup_mit_pool().await;
    let admin = admin(&app).await;
    let (p, _) = kleine_planung(&app, &admin, "Konzert").await;
    let vorschau = format!("{PFAD}/{p}/uebernahme/vorschau");

    // Ohne Recht zu planen 403, vor dem Ziel.
    benutzer_anlegen(&app, &admin, "beobachter", "keine").await;
    let beob = login_cookie(&app, "beobachter", "beobachterpw1").await;
    let (s, _) = post(&app, &beob, &vorschau, json!({"ziel": {"art": "neu"}})).await;
    assert_eq!(s, StatusCode::FORBIDDEN);

    // Ein unbekannter oder fremder Einsatz ist 404.
    let (s, v) = post(
        &app,
        &admin,
        &vorschau,
        json!({"ziel": {"art": "einsatz", "einsatz_id": 999999}}),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND, "{v}");
    fremde_org_anlegen(&pool, "Andere", "fremd", "fremdpw12", "fuehrungskraft").await;
    let fremd = login_cookie(&app, "fremd", "fremdpw12").await;
    let fremder_einsatz = einsatz_anlegen(&app, &fremd).await;
    let (s, v) = post(
        &app,
        &admin,
        &vorschau,
        json!({"ziel": {"art": "einsatz", "einsatz_id": fremder_einsatz}}),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND, "{v}");

    // Eine Führungskraft ohne Schreibrecht im Einsatz: 403.
    benutzer_anlegen(&app, &admin, "kraft", "fuehrungskraft").await;
    let kraft = login_cookie(&app, "kraft", "kraftpw1").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (s, v) = post(
        &app,
        &kraft,
        &vorschau,
        json!({"ziel": {"art": "einsatz", "einsatz_id": einsatz}}),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN, "{v}");

    // Ein abgeschlossener Einsatz nimmt nichts mehr an: 409.
    let (s, v) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschliessen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let (s, v) = post(
        &app,
        &admin,
        &format!("{PFAD}/{p}/uebernahme"),
        json!({"ziel": {"art": "einsatz", "einsatz_id": einsatz}}),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "{v}");

    // Eine unbekannte Art des Ziels oder eine fremde Vorlage: 400.
    let (s, _) = post(
        &app,
        &admin,
        &vorschau,
        json!({"ziel": {"art": "irgendwo"}}),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    let (s, v) = post(
        &app,
        &admin,
        &vorschau,
        json!({"ziel": {"art": "neu", "vorlage_id": 999999}}),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{v}");

    // Die Planung bleibt dabei unberührt und übernehmbar.
    let plan = get(&app, &admin, &format!("{PFAD}/{p}")).await;
    assert!(plan["kopf"].get("uebernahme").is_none(), "{plan}");
}

#[tokio::test]
async fn entscheidung_neu_statt_bestehender_einheit() {
    let app = setup().await;
    let admin = admin(&app).await;
    let (p, _) = kleine_planung(&app, &admin, "Konzert").await;
    let einsatz = einsatz_anlegen_mit(&app, &admin, "Konzert").await;
    einheit_bilden(&app, &admin, einsatz, "Streife 2").await;
    let ziel = json!({"art": "einsatz", "einsatz_id": einsatz});
    let (_, vorschau) = post(
        &app,
        &admin,
        &format!("{PFAD}/{p}/uebernahme/vorschau"),
        json!({"ziel": ziel}),
    )
    .await;
    let schluessel = vorschau["posten"][0]["schluessel"].as_str().unwrap();
    let (s, ergebnis) = post(
        &app,
        &admin,
        &format!("{PFAD}/{p}/uebernahme"),
        json!({"ziel": ziel, "entscheidungen": {"posten": {schluessel: {"art": "neu"}}}}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{ergebnis}");
    assert_eq!(ergebnis["zaehlung"]["einheiten_neu"], 1, "{ergebnis}");
}
