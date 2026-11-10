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

/// Übernimmt mit dem Stand einer frischen Vorschau desselben Ziels (LLH-1610); scheitert die
/// Vorschau, mit Stand 0 (der Fehler der Übernahme selbst ist dann gemeint).
async fn uebernehmen(app: &axum::Router, cookie: &str, p: i64, body: Value) -> (StatusCode, Value) {
    let (s, v) = post(
        app,
        cookie,
        &format!("{PFAD}/{p}/uebernahme/vorschau"),
        body.clone(),
    )
    .await;
    let stand = if s == StatusCode::OK {
        v["stand"].as_i64().expect("stand")
    } else {
        0
    };
    let mut body = body;
    body["stand"] = json!(stand);
    post(app, cookie, &format!("{PFAD}/{p}/uebernahme"), body).await
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

    let (s, ergebnis) = uebernehmen(&app, &admin, p, json!({"ziel": {"art": "neu"}})).await;
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
            json!({"ziel": {"art": "neu"}, "stand": 0}),
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

    let (s, ergebnis) = uebernehmen(
        &app,
        &admin,
        p,
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
    let (s, v) = uebernehmen(
        &app,
        &admin,
        p,
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
    let (s, ergebnis) = uebernehmen(
        &app,
        &admin,
        p,
        json!({"ziel": ziel, "entscheidungen": {"posten": {schluessel: {"art": "neu"}}}}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{ergebnis}");
    assert_eq!(ergebnis["zaehlung"]["einheiten_neu"], 1, "{ergebnis}");
}

#[tokio::test]
async fn block_ohne_soll_bleibt_ohne_soll_auch_mit_vorlage() {
    let (app, pool) = setup_mit_pool().await;
    let admin = admin(&app).await;
    let org: i64 = sqlx::query_scalar("SELECT org_id FROM benutzer WHERE benutzername = 'admin'")
        .fetch_one(&pool)
        .await
        .unwrap();
    let typ: i64 = sqlx::query_scalar("SELECT id FROM einheit_typ WHERE org_id = ? LIMIT 1")
        .bind(org)
        .fetch_one(&pool)
        .await
        .unwrap();
    let vorlage: i64 = sqlx::query_scalar(
        "INSERT INTO einheit_vorlage (org_id, name, typ_id, soll_fuehrer, soll_unterfuehrer, \
         soll_mannschaft) VALUES (?, 'SanTrupp', ?, 0, 1, 2) RETURNING id",
    )
    .bind(org)
    .bind(typ)
    .fetch_one(&pool)
    .await
    .unwrap();
    let (s, plan) = post(
        &app,
        &admin,
        PFAD,
        json!({"bezeichnung": "Konzert", "von": "2027-03-13 08:00:00", "bis": "2027-03-13 23:00:00"}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{plan}");
    let p = plan["kopf"]["id"].as_i64().unwrap();
    let (s, plan) = post(
        &app,
        &admin,
        &format!("{PFAD}/{p}/posten"),
        json!({"bezeichnung": "Trupp", "art": "einheit", "einheit_vorlage_id": vorlage}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{plan}");
    let posten = plan["posten"][0]["id"].as_i64().unwrap();
    for (von, bis, soll) in [
        ("2027-03-13 10:00:00", "2027-03-13 12:00:00", json!(null)),
        ("2027-03-13 12:00:00", "2027-03-13 14:00:00", json!(1)),
    ] {
        let (s, v) = post(
            &app,
            &admin,
            &format!("{PFAD}/{p}/bloecke"),
            json!({"posten_id": posten, "von": von, "bis": bis, "soll_anzahl": soll}),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{v}");
    }

    let (s, ergebnis) = uebernehmen(
        &app,
        &admin,
        p,
        json!({"ziel": {"art": "neu"}, "entscheidungen": {"posten": {
            format!("posten-{posten}"): {"art": "neu", "einheit_vorlage_id": vorlage}}}}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{ergebnis}");
    let einsatz = ergebnis["einsatz_id"].as_i64().unwrap();
    let plan = get(
        &app,
        &admin,
        &format!("/api/einsaetze/{einsatz}/abloesungen/schichtplan"),
    )
    .await;
    let bloecke = plan["bloecke"].as_array().unwrap();
    assert_eq!(bloecke.len(), 2, "{plan}");
    assert!(
        bloecke[0].get("soll_anzahl").is_none(),
        "leer bleibt leer, nicht das Soll 3 der Vorlage: {plan}"
    );
    assert_eq!(bloecke[1]["soll_anzahl"], 1, "{plan}");
}

#[tokio::test]
async fn posten_ohne_block_wird_einheit_und_laufender_einsatz_ohne_aenderung_ist_422() {
    let app = setup().await;
    let admin = admin(&app).await;
    let (s, plan) = post(
        &app,
        &admin,
        PFAD,
        json!({"bezeichnung": "Konzert", "von": "2027-03-13 08:00:00", "bis": "2027-03-13 23:00:00"}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{plan}");
    let p = plan["kopf"]["id"].as_i64().unwrap();
    for body in [
        json!({"bezeichnung": "Reserve", "art": "einheit"}),
        json!({"bezeichnung": "UHS Bühne", "art": "uhs", "uhs_typ": "behandlungsplatz"}),
    ] {
        let (s, v) = post(&app, &admin, &format!("{PFAD}/{p}/posten"), body).await;
        assert_eq!(s, StatusCode::CREATED, "{v}");
    }

    // In einen laufenden Einsatz, der beide schon hat: nichts zu tun, 422, Planung bleibt offen.
    let einsatz = einsatz_anlegen_mit(&app, &admin, "Konzert").await;
    einheit_bilden(&app, &admin, einsatz, "Reserve").await;
    let (s, v) = post(
        &app,
        &admin,
        &format!("/api/einsaetze/{einsatz}/uhs"),
        json!({"bezeichnung": "UHS Bühne", "typ": "behandlungsplatz"}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let ziel = json!({"ziel": {"art": "einsatz", "einsatz_id": einsatz}});
    let (s, vorschau) = post(
        &app,
        &admin,
        &format!("{PFAD}/{p}/uebernahme/vorschau"),
        ziel.clone(),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{vorschau}");
    assert_eq!(vorschau["zaehlung"]["aenderungen"], 0, "{vorschau}");
    let (s, v) = uebernehmen(&app, &admin, p, ziel).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    let plan = get(&app, &admin, &format!("{PFAD}/{p}")).await;
    assert!(plan["kopf"].get("uebernahme").is_none(), "{plan}");

    // In einen neuen Einsatz: beide Posten entstehen, obwohl kein Block sie braucht.
    let (s, ergebnis) = uebernehmen(&app, &admin, p, json!({"ziel": {"art": "neu"}})).await;
    assert_eq!(s, StatusCode::OK, "{ergebnis}");
    assert_eq!(ergebnis["zaehlung"]["einheiten_neu"], 1, "{ergebnis}");
    assert_eq!(ergebnis["zaehlung"]["uhs_neu"], 1, "{ergebnis}");
    let neu = ergebnis["einsatz_id"].as_i64().unwrap();
    let einheiten = get(&app, &admin, &format!("/api/einsaetze/{neu}/einheiten")).await;
    assert!(einheiten.to_string().contains("\"Reserve\""), "{einheiten}");
    let uhs = get(&app, &admin, &format!("/api/einsaetze/{neu}/uhs")).await;
    assert!(uhs.to_string().contains("\"UHS Bühne\""), "{uhs}");
}

/// LLH-1611: Eine Qualifikation, die nach dem Planen deaktiviert wird, nennt die Vorschau mit
/// ihrem Namen, nicht mit ihrer Nummer; übernommen wird sie nicht.
#[tokio::test]
async fn deaktivierte_qualifikation_nennt_die_vorschau_mit_namen() {
    let app = setup().await;
    let admin = admin(&app).await;
    let (s, q) = post(
        &app,
        &admin,
        "/api/qualifikationen",
        json!({"label": "Bootsführer"}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{q}");
    let q = q["id"].as_i64().unwrap();
    let (s, plan) = post(
        &app,
        &admin,
        PFAD,
        json!({"bezeichnung": "Regatta", "von": "2027-03-13 08:00:00", "bis": "2027-03-13 23:00:00"}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{plan}");
    let p = plan["kopf"]["id"].as_i64().unwrap();
    let (s, plan) = post(
        &app,
        &admin,
        &format!("{PFAD}/{p}/posten"),
        json!({"bezeichnung": "Boot 1", "art": "einheit"}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{plan}");
    let posten = plan["posten"][0]["id"].as_i64().unwrap();
    let (s, v) = post(
        &app,
        &admin,
        &format!("{PFAD}/{p}/bloecke"),
        json!({"posten_id": posten, "von": "2027-03-13 10:00:00", "bis": "2027-03-13 12:00:00",
               "soll_anzahl": 2, "quali_soll": [{"qualifikation_id": q, "anzahl": 1}]}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");

    let (s, v) = anfrage(
        &app,
        "POST",
        &format!("/api/qualifikationen/{q}/deaktivieren"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT, "{v}");

    let (s, vorschau) = post(
        &app,
        &admin,
        &format!("{PFAD}/{p}/uebernahme/vorschau"),
        json!({"ziel": {"art": "neu"}}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{vorschau}");
    let texte: Vec<&str> = vorschau["meldungen"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["text"].as_str().unwrap())
        .collect();
    assert!(
        texte.contains(&"Qualifikation «Bootsführer» deaktiviert, ausgelassen"),
        "{vorschau}"
    );
    assert!(
        !texte.iter().any(|t| t.contains(&format!("#{q}"))),
        "keine Nummer: {vorschau}"
    );
    assert_eq!(vorschau["uebernehmbar"], true, "{vorschau}");
}

/// Der Stand der Planung aus einer Vorschau „neuer Einsatz“ (LLH-1610).
async fn stand(app: &axum::Router, cookie: &str, p: i64) -> i64 {
    let (s, v) = post(
        app,
        cookie,
        &format!("{PFAD}/{p}/uebernahme/vorschau"),
        json!({"ziel": {"art": "neu"}}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    v["stand"].as_i64().expect("stand in der Vorschau")
}

/// LLH-1610: Ändert jemand die Planung zwischen Vorschau und „Übernehmen“, ist die Übernahme 409
/// und schreibt nichts; die Planung bleibt beschreibbar, mit dem neuen Stand geht es.
#[tokio::test]
async fn geaenderte_planung_seit_der_vorschau_ist_409_und_bleibt_beschreibbar() {
    let app = setup().await;
    let admin = admin(&app).await;
    let (p, _) = kleine_planung(&app, &admin, "Konzert").await;
    let einsaetze = einsatz_anzahl(&app, &admin).await;
    let ziel = json!({"art": "neu"});
    let uebernahme = format!("{PFAD}/{p}/uebernahme");

    let alt = stand(&app, &admin, p).await;

    // Ohne Stand 400, vor allem anderen.
    let (s, v) = post(&app, &admin, &uebernahme, json!({"ziel": ziel})).await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{v}");

    // Jemand anderes verlängert den Block nach der Vorschau.
    let plan = get(&app, &admin, &format!("{PFAD}/{p}")).await;
    let block = &plan["bloecke"][0];
    let (s, v) = anfrage_json(
        &app,
        "PATCH",
        &format!("{PFAD}/{p}/bloecke/{}", block["id"]),
        &admin,
        Some(&json!({"version": block["version"], "bis": "2027-03-13 19:00:00"})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");

    let (s, v) = post(
        &app,
        &admin,
        &uebernahme,
        json!({"ziel": ziel, "stand": alt}),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "{v}");
    assert_eq!(
        einsatz_anzahl(&app, &admin).await,
        einsaetze,
        "kein Einsatz angelegt"
    );
    let plan = get(&app, &admin, &format!("{PFAD}/{p}")).await;
    assert!(plan["kopf"].get("uebernahme").is_none(), "{plan}");

    // Die Planung bleibt beschreibbar.
    let posten = plan["posten"][0]["id"].as_i64().unwrap();
    let (s, v) = anfrage_json(
        &app,
        "PATCH",
        &format!("{PFAD}/{p}/posten/{posten}"),
        &admin,
        Some(&json!({"bezeichnung": "Streife 3"})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");

    // Mit dem Stand einer neuen Vorschau übernimmt sie, was diese zeigt.
    let neu = stand(&app, &admin, p).await;
    assert!(neu > alt, "{neu} > {alt}");
    let (s, v) = post(
        &app,
        &admin,
        &uebernahme,
        json!({"ziel": ziel, "stand": neu}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let einsatz = v["einsatz_id"].as_i64().unwrap();
    let schichtplan = get(
        &app,
        &admin,
        &format!("/api/einsaetze/{einsatz}/abloesungen/schichtplan"),
    )
    .await;
    assert_eq!(
        schichtplan["bloecke"][0]["bis"], "2027-03-13 19:00:00",
        "{schichtplan}"
    );
}

/// LLH-1610: Jeder Schreibweg der Planung erhöht ihren Stand, die Vorschau selbst nicht.
#[tokio::test]
async fn jeder_schreibweg_erhoeht_den_stand() {
    let app = setup().await;
    let admin = admin(&app).await;
    let (p, _) = kleine_planung(&app, &admin, "Konzert").await;
    let mut zuletzt = stand(&app, &admin, p).await;
    assert_eq!(
        stand(&app, &admin, p).await,
        zuletzt,
        "Vorschau zählt nicht"
    );

    let plan = get(&app, &admin, &format!("{PFAD}/{p}")).await;
    let streife = plan["posten"][0]["id"].as_i64().unwrap();
    let helfer = plan["helfer"][0]["id"].as_i64().unwrap();

    // (Methode, Pfad, Körper) je Schreibweg; Kennungen, die erst entstehen, holt `plan` danach.
    let schritte: Vec<(&str, String, Option<Value>)> = vec![
        (
            "PATCH",
            format!("{PFAD}/{p}"),
            Some(json!({"version": plan["kopf"]["version"], "ort": "Stadtpark"})),
        ),
        (
            "POST",
            format!("{PFAD}/{p}/posten"),
            Some(json!({"bezeichnung": "Reserve", "art": "einheit", "schichtlaenge_minuten": 120})),
        ),
        (
            "PATCH",
            format!("{PFAD}/{p}/posten/{streife}"),
            Some(json!({"abschnitt": "Nord"})),
        ),
        (
            "POST",
            format!("{PFAD}/{p}/helfer"),
            Some(json!({"name": "Spät Dazu"})),
        ),
        (
            "PATCH",
            format!("{PFAD}/{p}/helfer/{helfer}"),
            Some(json!({"telefon": "0170 7654321"})),
        ),
        (
            "POST",
            format!("{PFAD}/{p}/programmpunkte"),
            Some(json!({"bezeichnung": "Einlass", "zeitpunkt_at": "2027-03-13 17:00:00"})),
        ),
    ];
    for (methode, pfad, body) in schritte {
        let (s, v) = anfrage_json(&app, methode, &pfad, &admin, body.as_ref()).await;
        assert!(s.is_success(), "{methode} {pfad}: {s} {v}");
        let jetzt = stand(&app, &admin, p).await;
        assert!(jetzt > zuletzt, "{methode} {pfad}: {jetzt} > {zuletzt}");
        zuletzt = jetzt;
    }

    // Wege mit Kennungen, die eben entstanden sind.
    let plan = get(&app, &admin, &format!("{PFAD}/{p}")).await;
    let reserve = plan["posten"]
        .as_array()
        .unwrap()
        .iter()
        .find(|x| x["bezeichnung"] == "Reserve")
        .unwrap()["id"]
        .as_i64()
        .unwrap();
    let spaet = plan["helfer"]
        .as_array()
        .unwrap()
        .iter()
        .find(|x| x["name"] == "Spät Dazu")
        .unwrap()["id"]
        .as_i64()
        .unwrap();
    let einlass = plan["programmpunkte"][0]["id"].as_i64().unwrap();
    let schritte: Vec<(&str, String, Option<Value>)> = vec![
        (
            "PUT",
            format!("{PFAD}/{p}/posten/reihenfolge"),
            Some(json!({"posten_ids": [reserve, streife]})),
        ),
        (
            "POST",
            format!("{PFAD}/{p}/bloecke"),
            Some(json!({"posten_id": reserve, "von": "2027-03-13 09:00:00",
                        "bis": "2027-03-13 11:00:00"})),
        ),
        (
            "POST",
            format!("{PFAD}/{p}/erzeugen"),
            Some(json!({"posten_id": reserve, "von": "2027-03-13 18:00:00",
                        "bis": "2027-03-13 22:00:00"})),
        ),
        (
            "PATCH",
            format!("{PFAD}/{p}/programmpunkte/{einlass}"),
            Some(json!({"bezeichnung": "Einlass Bühne"})),
        ),
        (
            "DELETE",
            format!("{PFAD}/{p}/programmpunkte/{einlass}"),
            None,
        ),
        ("DELETE", format!("{PFAD}/{p}/helfer/{spaet}"), None),
    ];
    for (methode, pfad, body) in schritte {
        let (s, v) = anfrage_json(&app, methode, &pfad, &admin, body.as_ref()).await;
        assert!(s.is_success(), "{methode} {pfad}: {s} {v}");
        let jetzt = stand(&app, &admin, p).await;
        assert!(jetzt > zuletzt, "{methode} {pfad}: {jetzt} > {zuletzt}");
        zuletzt = jetzt;
    }

    // Block ändern und löschen, zuletzt den Posten samt Blöcken.
    let plan = get(&app, &admin, &format!("{PFAD}/{p}")).await;
    let block = plan["bloecke"]
        .as_array()
        .unwrap()
        .iter()
        .find(|b| b["von"] == "2027-03-13 09:00:00")
        .unwrap()
        .clone();
    let schritte: Vec<(&str, String, Option<Value>)> = vec![
        (
            "PATCH",
            format!("{PFAD}/{p}/bloecke/{}", block["id"]),
            Some(json!({"version": block["version"], "notiz": "Funk prüfen"})),
        ),
        (
            "DELETE",
            format!(
                "{PFAD}/{p}/bloecke/{}?version={}",
                block["id"],
                block["version"].as_i64().unwrap() + 1
            ),
            None,
        ),
        (
            "DELETE",
            format!("{PFAD}/{p}/posten/{reserve}?mit_bloecken=true"),
            None,
        ),
    ];
    for (methode, pfad, body) in schritte {
        let (s, v) = anfrage_json(&app, methode, &pfad, &admin, body.as_ref()).await;
        assert!(s.is_success(), "{methode} {pfad}: {s} {v}");
        let jetzt = stand(&app, &admin, p).await;
        assert!(jetzt > zuletzt, "{methode} {pfad}: {jetzt} > {zuletzt}");
        zuletzt = jetzt;
    }

    // Ein abgelehnter Schreibweg (409) rollt den Stand mit zurück.
    let (s, _) = anfrage_json(
        &app,
        "PATCH",
        &format!("{PFAD}/{p}"),
        &admin,
        Some(&json!({"version": 0, "ort": "Veraltet"})),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
    assert_eq!(stand(&app, &admin, p).await, zuletzt, "Fehler zählt nicht");
}
