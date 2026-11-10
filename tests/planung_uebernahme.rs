//! Integrationstests „Planung übernehmen“ (LLH-1587, Spec `vorplanung`, „Übernahme in einen
//! Einsatz“): die Demo-Planung Stadtfest in einen neuen Einsatz, eine eigene Planung in einen
//! laufenden Einsatz, Vorschau ohne Schreiben, Schreibschutz danach (409), Rechte und Ziele.
//! Fehlende Abschnitte neuer Posten entstehen mit (LLH-1609), im neuen wie im laufenden Einsatz.
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

/// Die Abschnitte eines Einsatzes nach Namen, in ihrer Reihenfolge.
async fn abschnitt_namen(pool: &sqlx::SqlitePool, einsatz: i64) -> Vec<String> {
    sqlx::query_scalar(
        "SELECT name FROM einsatzabschnitt WHERE einsatz_id = ? ORDER BY sortier, id",
    )
    .bind(einsatz)
    .fetch_all(pool)
    .await
    .unwrap()
}

/// Jede Einheit und UHS des Einsatzes mit dem Namen ihres Abschnitts, nach Namen sortiert.
async fn posten_abschnitte(pool: &sqlx::SqlitePool, einsatz: i64) -> Vec<(String, Option<String>)> {
    sqlx::query_as(
        "SELECT e.name, a.name FROM einsatz_einheit e \
         LEFT JOIN einsatzabschnitt a ON a.id = e.abschnitt_id WHERE e.einsatz_id = ?1 \
         UNION ALL \
         SELECT u.bezeichnung, a.name FROM uhs u \
         LEFT JOIN einsatzabschnitt a ON a.id = u.abschnitt_id WHERE u.einsatz_id = ?1 \
         ORDER BY 1",
    )
    .bind(einsatz)
    .fetch_all(pool)
    .await
    .unwrap()
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
    let (app, pool) = setup_mit_optionen(AN).await;
    let admin = admin(&app).await;
    let p = stadtfest_planung(&app, &admin).await;
    let vorher = get(&app, &admin, &format!("{PFAD}/{p}")).await;
    let einsaetze = einsatz_anzahl(&app, &admin).await;
    let abschnitte_gesamt = || async {
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM einsatzabschnitt")
            .fetch_one(&pool)
            .await
            .unwrap()
    };
    let abschnitte_vorher = abschnitte_gesamt().await;

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
    // Die Abschnitte der Planung entstehen mit, in der Reihenfolge der Posten (LLH-1609).
    assert_eq!(z["abschnitte_neu"], 3, "{z}");
    assert_eq!(
        vorschau["abschnitte_neu"],
        json!(["Marktplatz", "Festmeile", "Bühne"]),
        "{vorschau}"
    );
    for posten in vorschau["posten"].as_array().unwrap() {
        assert_eq!(
            posten["abschnitt_neu"],
            posten.get("abschnitt").is_some(),
            "nur der KTW hat keinen Abschnitt: {posten}"
        );
    }
    assert!(
        !vorschau["meldungen"].to_string().contains("nicht gefunden"),
        "{vorschau}"
    );
    assert_eq!(
        abschnitte_gesamt().await,
        abschnitte_vorher,
        "Vorschau legt keinen Abschnitt an"
    );
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
    let etb = system_etb_inhalte(&app, &admin, einsatz).await;
    assert!(
        etb.iter().any(
            |t| t.starts_with("Planung „Stadtfest Musterstadt“ übernommen:")
                && t.contains("3 Abschnitte neu")
        ),
        "ETB nennt die Planung und die neuen Abschnitte: {etb:?}"
    );
    assert!(
        etb.iter().any(|t| t == "Abschnitt «Festmeile» angelegt"),
        "{etb:?}"
    );

    // Jede Einheit und UHS steht im Abschnitt ihres Postens; der KTW hat keinen.
    assert_eq!(
        abschnitt_namen(&pool, einsatz).await,
        ["Marktplatz", "Festmeile", "Bühne"]
    );
    let s = |x: &str| Some(x.to_string());
    assert_eq!(
        posten_abschnitte(&pool, einsatz).await,
        [
            ("KTW Musterstadt 87-85".to_string(), None),
            ("Sanitätswache Bühne".to_string(), s("Bühne")),
            ("Streife 1".to_string(), s("Festmeile")),
            ("Streife 2".to_string(), s("Festmeile")),
            ("UHS Marktplatz".to_string(), s("Marktplatz")),
        ]
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

    let (s, ergebnis) = post(
        &app,
        &admin,
        &format!("{PFAD}/{p}/uebernahme"),
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
    let (s, v) = post(&app, &admin, &format!("{PFAD}/{p}/uebernahme"), ziel).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    let plan = get(&app, &admin, &format!("{PFAD}/{p}")).await;
    assert!(plan["kopf"].get("uebernahme").is_none(), "{plan}");

    // In einen neuen Einsatz: beide Posten entstehen, obwohl kein Block sie braucht.
    let (s, ergebnis) = post(
        &app,
        &admin,
        &format!("{PFAD}/{p}/uebernahme"),
        json!({"ziel": {"art": "neu"}}),
    )
    .await;
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

/// Legt in der Planung `p` einen Posten (ohne Block) an.
async fn posten_anlegen(app: &axum::Router, cookie: &str, p: i64, body: Value) {
    let (s, v) = post(app, cookie, &format!("{PFAD}/{p}/posten"), body).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
}

async fn abschnitt_anlegen(app: &axum::Router, cookie: &str, einsatz: i64, name: &str) -> i64 {
    let (s, v) = post(
        app,
        cookie,
        &format!("/api/einsaetze/{einsatz}/abschnitte"),
        json!({"name": name, "sortier": 0}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    v["id"].as_i64().unwrap()
}

/// LLH-1609, Entscheidung Ruben 10.11.2026 (Variante A): auch ein laufender Einsatz bekommt die
/// fehlenden Abschnitte seiner neuen Posten. Ein vorhandener Abschnitt wird genutzt (auch über
/// andere Schreibweise), und für einen Posten, der eine bestehende Einheit trifft, entsteht kein
/// leerer Abschnitt.
#[tokio::test]
async fn laufender_einsatz_bekommt_fehlende_abschnitte_neuer_posten() {
    let (app, pool) = setup_mit_pool().await;
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
        json!({"bezeichnung": "Streife 1", "art": "einheit", "abschnitt": "Festmeile"}),
        json!({"bezeichnung": "Streife 2", "art": "einheit", "abschnitt": " festmeile "}),
        json!({"bezeichnung": "Streife 3", "art": "einheit", "abschnitt": "nord"}),
        json!({"bezeichnung": "UHS Bühne", "art": "uhs", "uhs_typ": "behandlungsplatz",
               "abschnitt": "Bühne"}),
        json!({"bezeichnung": "Reserve", "art": "einheit", "abschnitt": "Lager"}),
    ] {
        posten_anlegen(&app, &admin, p, body).await;
    }
    let einsatz = einsatz_anlegen_mit(&app, &admin, "Konzert").await;
    let nord = abschnitt_anlegen(&app, &admin, einsatz, "Nord").await;
    let reserve = einheit_bilden(&app, &admin, einsatz, "Reserve").await;
    let ziel = json!({"ziel": {"art": "einsatz", "einsatz_id": einsatz}});

    let (s, vorschau) = post(
        &app,
        &admin,
        &format!("{PFAD}/{p}/uebernahme/vorschau"),
        ziel.clone(),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{vorschau}");
    assert_eq!(
        vorschau["abschnitte_neu"],
        json!(["Festmeile", "Bühne"]),
        "{vorschau}"
    );
    assert_eq!(vorschau["zaehlung"]["abschnitte_neu"], 2, "{vorschau}");
    let posten = |name: &str| {
        vorschau["posten"]
            .as_array()
            .unwrap()
            .iter()
            .find(|x| x["name"] == name)
            .unwrap()
            .clone()
    };
    assert_eq!(posten("Streife 1")["abschnitt_neu"], true);
    assert_eq!(posten("Streife 3")["abschnitt_neu"], false);
    assert_eq!(posten("Streife 3")["abschnitt_id"], nord);
    assert_eq!(posten("Reserve")["ziel"]["einheit_id"], reserve);
    assert_eq!(posten("Reserve")["abschnitt_neu"], false);
    assert_eq!(
        abschnitt_namen(&pool, einsatz).await,
        ["Nord"],
        "Vorschau schreibt nichts"
    );

    let (s, ergebnis) = post(&app, &admin, &format!("{PFAD}/{p}/uebernahme"), ziel).await;
    assert_eq!(s, StatusCode::OK, "{ergebnis}");
    assert_eq!(ergebnis["zaehlung"]["abschnitte_neu"], 2, "{ergebnis}");
    assert_eq!(
        abschnitt_namen(&pool, einsatz).await,
        ["Nord", "Festmeile", "Bühne"],
        "kein Abschnitt „Lager“: Reserve bleibt, wo sie ist"
    );
    let s = |x: &str| Some(x.to_string());
    assert_eq!(
        posten_abschnitte(&pool, einsatz).await,
        [
            ("Reserve".to_string(), None),
            ("Streife 1".to_string(), s("Festmeile")),
            ("Streife 2".to_string(), s("Festmeile")),
            ("Streife 3".to_string(), s("Nord")),
            ("UHS Bühne".to_string(), s("Bühne")),
        ]
    );
}

/// Ohne Freigabe des Moduls Einsatzabschnitte entsteht kein Abschnitt; der Posten bleibt ohne
/// und die Vorschau sagt es wie vor LLH-1609. Ausgeblendet trifft es nur Nicht-Admins: eine
/// Führungskraft als Einsatzleitung.
#[tokio::test]
async fn ohne_modul_abschnitte_bleibt_der_hinweis() {
    let (app, pool) = setup_mit_pool().await;
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
    posten_anlegen(
        &app,
        &admin,
        p,
        json!({"bezeichnung": "Streife 1", "art": "einheit", "abschnitt": "Festmeile"}),
    )
    .await;
    let einsatz = einsatz_anlegen_mit(&app, &admin, "Konzert").await;
    let (s, v) = anfrage_json(
        &app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/modul-overrides/einsatzabschnitte"),
        &admin,
        Some(&json!({"sichtbar": false})),
    )
    .await;
    assert!(s.is_success(), "{s}: {v}");
    let kraft_id = benutzer_anlegen(&app, &admin, "kraft", "fuehrungskraft").await;
    rolle_setzen(&app, &admin, einsatz, kraft_id, "einsatzleitung").await;
    let kraft = login_cookie(&app, "kraft", "kraftpw1").await;
    let ziel = json!({"ziel": {"art": "einsatz", "einsatz_id": einsatz}});

    let (s, vorschau) = post(
        &app,
        &kraft,
        &format!("{PFAD}/{p}/uebernahme/vorschau"),
        ziel.clone(),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{vorschau}");
    assert_eq!(vorschau["abschnitte_neu"], json!([]), "{vorschau}");
    assert!(
        vorschau["meldungen"]
            .to_string()
            .contains("Abschnitt «Festmeile» nicht gefunden"),
        "{vorschau}"
    );
    let (s, ergebnis) = post(&app, &kraft, &format!("{PFAD}/{p}/uebernahme"), ziel).await;
    assert_eq!(s, StatusCode::OK, "{ergebnis}");
    assert!(abschnitt_namen(&pool, einsatz).await.is_empty());
    assert_eq!(
        posten_abschnitte(&pool, einsatz).await,
        [("Streife 1".to_string(), None)]
    );
}
