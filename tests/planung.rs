//! Integrationstests der Vorplanung ohne Einsatz (LLH-1585, Spec `vorplanung`): Planungen der
//! Organisation mit Posten, Schichten und Helfern, Rechte, Prüfbefunde ohne Ist, Kennzahlen der
//! Liste und die Löschfrist. Die Kennzahlen im Einzelnen prüft `src/planung/tests.rs`.

use axum::http::StatusCode;
use chrono::{Duration, DurationRound, Utc};
use serde_json::{json, Value};

mod common;
use common::*;

const PFAD: &str = "/api/planungen";

async fn admin(app: &axum::Router) -> String {
    login_cookie(app, "admin", "startpw12").await
}

async fn post(app: &axum::Router, cookie: &str, pfad: &str, body: Value) -> (StatusCode, Value) {
    anfrage_json(app, "POST", pfad, cookie, Some(&body)).await
}

async fn patch(app: &axum::Router, cookie: &str, pfad: &str, body: Value) -> (StatusCode, Value) {
    anfrage_json(app, "PATCH", pfad, cookie, Some(&body)).await
}

/// Legt eine Planung am 13.03.2027 von `von` bis `bis` an und liefert ihre Kennung.
async fn planung(app: &axum::Router, cookie: &str, name: &str) -> i64 {
    let (s, json) = post(
        app,
        cookie,
        PFAD,
        json!({"bezeichnung": name, "von": "2027-03-13 08:00:00", "bis": "2027-03-13 23:00:00"}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{json}");
    json["kopf"]["id"].as_i64().unwrap()
}

/// Legt einen freien Posten an und liefert seine Kennung.
async fn posten(app: &axum::Router, cookie: &str, p: i64, body: Value) -> i64 {
    let (s, json) = post(app, cookie, &format!("{PFAD}/{p}/posten"), body.clone()).await;
    assert_eq!(s, StatusCode::CREATED, "{json}");
    let name = body["bezeichnung"].as_str().unwrap();
    json["posten"]
        .as_array()
        .unwrap()
        .iter()
        .find(|x| x["bezeichnung"] == name)
        .unwrap_or_else(|| panic!("Posten {name} fehlt: {json}"))["id"]
        .as_i64()
        .unwrap()
}

async fn block(app: &axum::Router, cookie: &str, p: i64, body: Value) -> (StatusCode, Value) {
    post(app, cookie, &format!("{PFAD}/{p}/bloecke"), body).await
}

fn bloecke(plan: &Value) -> &Vec<Value> {
    plan["bloecke"].as_array().unwrap()
}

async fn org_von(pool: &sqlx::SqlitePool, benutzername: &str) -> i64 {
    sqlx::query_scalar("SELECT org_id FROM benutzer WHERE benutzername = ?")
        .bind(benutzername)
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn ohne_recht_403_fremde_planung_404() {
    let (app, pool) = setup_mit_pool().await;
    let admin = admin(&app).await;
    let p = planung(&app, &admin, "Stadtfest").await;

    benutzer_anlegen(&app, &admin, "beobachter", "keine").await;
    let beob = login_cookie(&app, "beobachter", "beobachterpw1").await;
    let (s, _) = anfrage(&app, "GET", PFAD, &beob, None).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, _) = anfrage(&app, "GET", &format!("{PFAD}/{p}"), &beob, None).await;
    assert_eq!(s, StatusCode::FORBIDDEN, "erst das Recht, dann die Planung");

    benutzer_anlegen(&app, &admin, "kraft", "fuehrungskraft").await;
    let kraft = login_cookie(&app, "kraft", "kraftpw1").await;
    let (s, liste) = anfrage(&app, "GET", PFAD, &kraft, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(
        liste.as_array().unwrap().len(),
        1,
        "Führungskraft sieht die Planung"
    );

    fremde_org_anlegen(&pool, "Andere", "fremd", "fremdpw12", "fuehrungskraft").await;
    let fremd = login_cookie(&app, "fremd", "fremdpw12").await;
    let (s, liste) = anfrage(&app, "GET", PFAD, &fremd, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(liste, json!([]), "fremde Org sieht nichts");
    for (methode, pfad) in [
        ("GET", format!("{PFAD}/{p}")),
        ("DELETE", format!("{PFAD}/{p}")),
        ("GET", format!("{PFAD}/999999")),
    ] {
        let (s, _) = anfrage(&app, methode, &pfad, &fremd, None).await;
        assert_eq!(s, StatusCode::NOT_FOUND, "{methode} {pfad}");
    }
    let (s, _) = post(
        &app,
        &fremd,
        &format!("{PFAD}/{p}/posten"),
        json!({"bezeichnung": "X", "art": "einheit"}),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn anlegen_und_liste_ohne_einsatz_doppelte_bezeichnung_409() {
    let app = setup().await;
    let admin = admin(&app).await;
    let (_, einsaetze_vorher) = anfrage(&app, "GET", "/api/einsaetze", &admin, None).await;

    let (s, plan) = post(
        &app,
        &admin,
        PFAD,
        json!({"bezeichnung": "  Stadtfest  ", "ort": "Marktplatz",
               "von": "2027-03-13 08:00:00", "bis": "2027-03-13 22:00:00",
               "max_dienst_minuten": 600}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{plan}");
    let kopf = &plan["kopf"];
    assert_eq!(kopf["bezeichnung"], "Stadtfest");
    assert_eq!(kopf["einsatzart"], "sanitaetsdienst");
    assert_eq!(kopf["ort"], "Marktplatz");
    assert_eq!(kopf["von"], "2027-03-13 08:00:00");
    assert_eq!(
        kopf["loeschung_at"], "2027-06-11 22:00:00",
        "90 Tage nach dem Ende"
    );
    assert_eq!(plan["posten"], json!([]));
    assert_eq!(plan["kennzahlen"]["soll"], 0);

    let (_, einsaetze) = anfrage(&app, "GET", "/api/einsaetze", &admin, None).await;
    assert_eq!(einsaetze, einsaetze_vorher, "eine Planung ist kein Einsatz");

    let (s, _) = post(
        &app,
        &admin,
        PFAD,
        json!({"bezeichnung": "stadtfest", "von": "2027-04-01 08:00:00", "bis": "2027-04-01 10:00:00"}),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "Bezeichnung je Org eindeutig");

    let (s, liste) = anfrage(&app, "GET", PFAD, &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    let eintrag = &liste[0];
    assert_eq!(eintrag["bezeichnung"], "Stadtfest");
    assert_eq!(eintrag["posten_anzahl"], 0);
    assert_eq!(eintrag["bloecke_anzahl"], 0);
    assert!(eintrag["kennzahlen"].is_object(), "{eintrag}");

    let id = kopf["id"].as_i64().unwrap();
    let (s, _) = anfrage(&app, "DELETE", &format!("{PFAD}/{id}"), &admin, None).await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let (s, _) = anfrage(&app, "GET", &format!("{PFAD}/{id}"), &admin, None).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn grenzen_400_und_veralteter_stand_409() {
    let app = setup().await;
    let admin = admin(&app).await;
    for body in [
        json!({"bezeichnung": "x".repeat(201), "von": "2027-03-13 08:00:00", "bis": "2027-03-13 10:00:00"}),
        json!({"bezeichnung": "  ", "von": "2027-03-13 08:00:00", "bis": "2027-03-13 10:00:00"}),
        json!({"bezeichnung": "A", "von": "2027-03-13 10:00:00", "bis": "2027-03-13 10:00:00"}),
        json!({"bezeichnung": "A", "von": "2027-03-01 08:00:00", "bis": "2027-03-16 08:00:00"}),
        json!({"bezeichnung": "A", "von": "2027-03-13 08:00:00", "bis": "2027-03-13 10:00:00", "einsatzart": "quatsch"}),
        json!({"bezeichnung": "A", "von": "2027-03-13 08:00:00", "bis": "2027-03-13 10:00:00", "unbekannt": 1}),
    ] {
        let (s, json) = post(&app, &admin, PFAD, body.clone()).await;
        assert!(
            s == StatusCode::BAD_REQUEST || s == StatusCode::UNPROCESSABLE_ENTITY,
            "{body} → {s} {json}"
        );
        assert_ne!(s, StatusCode::CREATED);
    }

    let p = planung(&app, &admin, "Stadtfest").await;
    let (s, plan) = patch(
        &app,
        &admin,
        &format!("{PFAD}/{p}"),
        json!({"version": 1, "ort": "Rathaus"}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{plan}");
    assert_eq!(plan["kopf"]["ort"], "Rathaus");
    assert_eq!(plan["kopf"]["version"], 2);
    let (s, _) = patch(
        &app,
        &admin,
        &format!("{PFAD}/{p}"),
        json!({"version": 1, "ort": "Bahnhof"}),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "veralteter Stand");
}

#[tokio::test]
async fn posten_aus_vorlage_und_fahrzeug_uebernimmt_das_soll() {
    let (app, pool) = setup_mit_pool().await;
    let admin = admin(&app).await;
    let org = org_von(&pool, "admin").await;
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
    let (s, fz) = post(
        &app,
        &admin,
        "/api/fahrzeuge",
        json!({"funkrufname": "KTW 1", "staerke_fuehrer": 0, "staerke_unterfuehrer": 1,
               "staerke_mannschaft": 1}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{fz}");
    let fahrzeug = fz["id"].as_i64().unwrap();

    let p = planung(&app, &admin, "Stadtfest").await;
    let (s, plan) = post(
        &app,
        &admin,
        &format!("{PFAD}/{p}/posten"),
        json!({"bezeichnung": "Trupp", "art": "einheit", "einheit_vorlage_id": vorlage}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{plan}");
    let (s, plan) = post(
        &app,
        &admin,
        &format!("{PFAD}/{p}/posten"),
        json!({"bezeichnung": "KTW", "art": "einheit", "fahrzeug_id": fahrzeug}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{plan}");
    let posten = plan["posten"].as_array().unwrap();
    assert_eq!(posten[0]["einheit_vorlage_id"], vorlage);
    assert_eq!(posten[0]["soll_anzahl"], 3, "Stärke der Vorlage");
    assert_eq!(posten[1]["fahrzeug_id"], fahrzeug);
    assert_eq!(posten[1]["fahrzeug_funkrufname"], "KTW 1");
    assert_eq!(posten[1]["soll_anzahl"], 2, "Stärke des Fahrzeugs");

    // Vorlage und Fahrzeug zugleich, UHS ohne Typ, unbekannte Art: Feldfehler.
    for body in [
        json!({"bezeichnung": "X", "art": "einheit", "einheit_vorlage_id": vorlage, "fahrzeug_id": fahrzeug}),
        json!({"bezeichnung": "X", "art": "uhs"}),
        json!({"bezeichnung": "X", "art": "abschnitt"}),
    ] {
        let (s, _) = post(&app, &admin, &format!("{PFAD}/{p}/posten"), body.clone()).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{body}");
    }
    let (s, _) = post(
        &app,
        &admin,
        &format!("{PFAD}/{p}/posten"),
        json!({"bezeichnung": "ktw", "art": "einheit"}),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "Postenname je Planung eindeutig");

    let (s, plan) = anfrage_json(
        &app,
        "PUT",
        &format!("{PFAD}/{p}/posten/reihenfolge"),
        &admin,
        Some(&json!({"posten_ids": [posten[1]["id"], posten[0]["id"]]})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{plan}");
    assert_eq!(plan["posten"][0]["bezeichnung"], "KTW");
    let (s, _) = anfrage_json(
        &app,
        "PUT",
        &format!("{PFAD}/{p}/posten/reihenfolge"),
        &admin,
        Some(&json!({"posten_ids": [posten[1]["id"]]})),
    )
    .await;
    assert_eq!(
        s,
        StatusCode::UNPROCESSABLE_ENTITY,
        "jeder Posten genau einmal"
    );
}

#[tokio::test]
async fn ueberschneidung_am_posten_422_pause_darf_sich_ueberschneiden() {
    let app = setup().await;
    let admin = admin(&app).await;
    let p = planung(&app, &admin, "Stadtfest").await;
    let streife = posten(
        &app,
        &admin,
        p,
        json!({"bezeichnung": "Streife", "art": "einheit", "soll_anzahl": 2}),
    )
    .await;

    let (s, plan) = block(
        &app,
        &admin,
        p,
        json!({"posten_id": streife, "von": "2027-03-13 10:00:00", "bis": "2027-03-13 13:00:00"}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{plan}");
    assert_eq!(bloecke(&plan)[0]["soll_anzahl"], 2, "Soll aus dem Posten");
    let (s, json) = block(
        &app,
        &admin,
        p,
        json!({"posten_id": streife, "von": "2027-03-13 12:00:00", "bis": "2027-03-13 14:00:00"}),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{json}");

    for _ in 0..2 {
        let (s, json) = block(
            &app,
            &admin,
            p,
            json!({"von": "2027-03-13 12:00:00", "bis": "2027-03-13 13:00:00"}),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "Pause: {json}");
    }

    let (s, json) = block(
        &app,
        &admin,
        p,
        json!({"posten_id": streife, "von": "2027-03-13 10:03:00", "bis": "2027-03-13 11:00:00"}),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "Raster: {json}");
    let (s, json) = block(
        &app,
        &admin,
        p,
        json!({"posten_id": streife, "von": "2027-03-14 10:00:00", "bis": "2027-03-14 11:00:00"}),
    )
    .await;
    assert_eq!(
        s,
        StatusCode::CREATED,
        "über den Zeitraum hinaus (Aufbau am Vortag): {json}"
    );
}

#[tokio::test]
async fn erzeugen_fuellt_den_zeitraum_ohne_laenge_422() {
    let app = setup().await;
    let admin = admin(&app).await;
    let p = planung(&app, &admin, "Stadtfest").await;
    let mit = posten(
        &app,
        &admin,
        p,
        json!({"bezeichnung": "Streife", "art": "einheit", "schichtlaenge_minuten": 180}),
    )
    .await;
    let ohne = posten(
        &app,
        &admin,
        p,
        json!({"bezeichnung": "Wache", "art": "einheit"}),
    )
    .await;

    let (s, plan) = post(
        &app,
        &admin,
        &format!("{PFAD}/{p}/erzeugen"),
        json!({"posten_id": mit, "von": "2027-03-13 11:00:00", "bis": "2027-03-13 23:00:00"}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{plan}");
    let zeiten: Vec<(&str, &str)> = bloecke(&plan)
        .iter()
        .map(|b| (b["von"].as_str().unwrap(), b["bis"].as_str().unwrap()))
        .collect();
    assert_eq!(
        zeiten,
        vec![
            ("2027-03-13 11:00:00", "2027-03-13 14:00:00"),
            ("2027-03-13 14:00:00", "2027-03-13 17:00:00"),
            ("2027-03-13 17:00:00", "2027-03-13 20:00:00"),
            ("2027-03-13 20:00:00", "2027-03-13 23:00:00"),
        ]
    );

    let (s, json) = post(
        &app,
        &admin,
        &format!("{PFAD}/{p}/erzeugen"),
        json!({"posten_id": ohne, "von": "2027-03-13 11:00:00", "bis": "2027-03-13 23:00:00"}),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "ohne Länge: {json}");

    let (s, json) = post(
        &app,
        &admin,
        &format!("{PFAD}/{p}/erzeugen"),
        json!({"posten_id": mit, "von": "2027-03-13 12:00:00", "bis": "2027-03-13 15:00:00"}),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "überschneidet: {json}");
    let (_, plan) = anfrage(&app, "GET", &format!("{PFAD}/{p}"), &admin, None).await;
    assert_eq!(bloecke(&plan).len(), 4, "alles oder nichts");
}

#[tokio::test]
async fn befunde_ohne_ist_doppelt_und_kennzahlen() {
    let (app, pool) = setup_mit_pool().await;
    let admin = admin(&app).await;
    let mia = stammpersonal_anlegen(&app, &admin, "Mia Muster").await;
    let max = stammpersonal_anlegen(&app, &admin, "Max Muster").await;
    let p = planung(&app, &admin, "Stadtfest").await;
    let (s, helfer) = post(
        &app,
        &admin,
        &format!("{PFAD}/{p}/helfer"),
        json!({"name": "Nora Exempel", "organisation": "Helferkreis"}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{helfer}");
    let nora = helfer["id"].as_i64().unwrap();

    let a = posten(
        &app,
        &admin,
        p,
        json!({"bezeichnung": "A", "art": "einheit", "soll_anzahl": 2}),
    )
    .await;
    let b = posten(
        &app,
        &admin,
        p,
        json!({"bezeichnung": "B", "art": "einheit", "soll_anzahl": 2}),
    )
    .await;
    let (s, _) = block(
        &app,
        &admin,
        p,
        json!({"posten_id": a, "von": "2027-03-13 14:00:00", "bis": "2027-03-13 17:00:00",
               "personen": [{"art": "stamm", "personal_id": mia}, {"art": "helfer", "helfer_id": nora}]}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    let (s, plan) = block(
        &app,
        &admin,
        p,
        json!({"posten_id": b, "von": "2027-03-13 16:00:00", "bis": "2027-03-13 20:00:00",
               "personen": [{"art": "stamm", "personal_id": mia}]}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{plan}");
    assert_eq!(
        plan["kennzahlen"],
        json!({"soll": 4, "ist": 3, "offen": 1, "konflikte": 2})
    );
    let text = plan.to_string();
    assert!(text.contains(r#""art":"doppelt""#), "{text}");
    assert!(
        !text.contains("abweichung"),
        "ohne Einsatz kein Ist: {text}"
    );

    // Ad-hoc-Kräfte, unbekannte oder fremde Helfer und fremdes Personal gibt es in der Planung
    // nicht.
    let block_b = bloecke(&plan)
        .iter()
        .find(|x| x["posten_id"] == b)
        .unwrap()
        .clone();
    let pfad = format!("{PFAD}/{p}/bloecke/{}", block_b["id"]);
    let (s, _) = patch(
        &app,
        &admin,
        &pfad,
        json!({"version": block_b["version"], "personen": [{"art": "einsatz", "einsatz_personal_id": 1}]}),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    let (s, _) = patch(
        &app,
        &admin,
        &pfad,
        json!({"version": block_b["version"], "personen": [{"art": "helfer", "helfer_id": 999999}]}),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);

    let (fremde_org, _) =
        fremde_org_anlegen(&pool, "Andere", "fremd", "fremdpw12", "fuehrungskraft").await;
    let fremde_person: i64 =
        sqlx::query_scalar("INSERT INTO personal (org_id, name) VALUES (?, 'Fremd') RETURNING id")
            .bind(fremde_org)
            .fetch_one(&pool)
            .await
            .unwrap();
    let andere = planung(&app, &admin, "Herbstmarkt").await;
    let (s, h) = post(
        &app,
        &admin,
        &format!("{PFAD}/{andere}/helfer"),
        json!({"name": "Finn Platzhalter"}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{h}");
    for person in [
        json!({"art": "stamm", "personal_id": fremde_person}),
        json!({"art": "helfer", "helfer_id": h["id"]}),
    ] {
        let (s, _) = patch(
            &app,
            &admin,
            &pfad,
            json!({"version": block_b["version"], "personen": [person.clone()]}),
        )
        .await;
        assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{person}");
    }

    let (s, plan) = patch(
        &app,
        &admin,
        &pfad,
        json!({"version": block_b["version"], "personen": [{"art": "stamm", "personal_id": max}]}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{plan}");
    assert_eq!(
        plan["kennzahlen"],
        json!({"soll": 4, "ist": 3, "offen": 1, "konflikte": 0})
    );

    let (_, liste) = anfrage(&app, "GET", PFAD, &admin, None).await;
    assert_eq!(liste[0]["kennzahlen"], plan["kennzahlen"]);
    assert_eq!(liste[0]["posten_anzahl"], 2);
    assert_eq!(liste[0]["bloecke_anzahl"], 2);
}

#[tokio::test]
async fn posten_mit_eingeteilten_personen_nur_mit_bloecken_loeschen() {
    let app = setup().await;
    let admin = admin(&app).await;
    let mia = stammpersonal_anlegen(&app, &admin, "Mia Muster").await;
    let p = planung(&app, &admin, "Stadtfest").await;
    let a = posten(
        &app,
        &admin,
        p,
        json!({"bezeichnung": "A", "art": "einheit"}),
    )
    .await;
    let (s, _) = block(
        &app,
        &admin,
        p,
        json!({"posten_id": a, "von": "2027-03-13 14:00:00", "bis": "2027-03-13 17:00:00",
               "personen": [{"art": "stamm", "personal_id": mia}]}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);

    let pfad = format!("{PFAD}/{p}/posten/{a}");
    let (s, _) = anfrage(&app, "DELETE", &pfad, &admin, None).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
    let (s, _) = anfrage(
        &app,
        "DELETE",
        &format!("{pfad}?mit_bloecken=true"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let (_, plan) = anfrage(&app, "GET", &format!("{PFAD}/{p}"), &admin, None).await;
    assert_eq!(plan["posten"], json!([]));
    assert_eq!(plan["bloecke"], json!([]));
}

#[tokio::test]
async fn liste_mit_zwanzig_vollen_planungen() {
    let app = setup().await;
    let admin = admin(&app).await;
    let mia = stammpersonal_anlegen(&app, &admin, "Mia Muster").await;
    for i in 0..20 {
        let p = planung(&app, &admin, &format!("Planung {i:02}")).await;
        for n in 0..3 {
            let a = posten(
                &app,
                &admin,
                p,
                json!({"bezeichnung": format!("P{n}"), "art": "einheit", "soll_anzahl": 2,
                       "schichtlaenge_minuten": 180}),
            )
            .await;
            let (s, json) = post(
                &app,
                &admin,
                &format!("{PFAD}/{p}/erzeugen"),
                json!({"posten_id": a, "von": "2027-03-13 08:00:00", "bis": "2027-03-13 20:00:00"}),
            )
            .await;
            assert_eq!(s, StatusCode::CREATED, "{json}");
        }
        let (_, plan) = anfrage(&app, "GET", &format!("{PFAD}/{p}"), &admin, None).await;
        let erster = &bloecke(&plan)[0];
        let (s, _) = patch(
            &app,
            &admin,
            &format!("{PFAD}/{p}/bloecke/{}", erster["id"]),
            json!({"version": erster["version"], "personen": [{"art": "stamm", "personal_id": mia}]}),
        )
        .await;
        assert_eq!(s, StatusCode::OK);
    }

    let (s, liste) = anfrage(&app, "GET", PFAD, &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    let liste = liste.as_array().unwrap();
    assert_eq!(liste.len(), 20);
    for e in liste {
        assert_eq!(e["posten_anzahl"], 3);
        assert_eq!(e["bloecke_anzahl"], 12);
        assert_eq!(
            e["kennzahlen"],
            json!({"soll": 24, "ist": 1, "offen": 23, "konflikte": 0}),
            "{e}"
        );
    }
}

#[tokio::test]
async fn loeschfrist_90_tage_nach_dem_ende() {
    let (app, pool, live) = setup_mit_pool_und_live().await;
    let admin = admin(&app).await;
    let jetzt = Utc::now().duration_trunc(Duration::minutes(30)).unwrap();
    let fmt = |t: chrono::DateTime<Utc>| t.format("%Y-%m-%d %H:%M:%S").to_string();

    let mut ids = Vec::new();
    for (name, tage) in [("Alt", 91), ("Frisch", 89)] {
        let bis = jetzt - Duration::days(tage);
        let (s, json) = post(
            &app,
            &admin,
            PFAD,
            json!({"bezeichnung": name, "von": fmt(bis - Duration::hours(4)), "bis": fmt(bis)}),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{json}");
        ids.push(json["kopf"]["id"].as_i64().unwrap());
    }

    let (_, liste) = anfrage(&app, "GET", PFAD, &admin, None).await;
    assert!(
        liste
            .as_array()
            .unwrap()
            .iter()
            .all(|e| e["kennzahlen"].is_null()),
        "vergangene Planungen ohne Kennzahlen: {liste}"
    );

    lifeline_hub::einsatz::purge_scheduler::tick_einmal(&pool, &live, Utc::now()).await;

    let (s, _) = anfrage(&app, "GET", &format!("{PFAD}/{}", ids[0]), &admin, None).await;
    assert_eq!(s, StatusCode::NOT_FOUND, "nach 90 Tagen gelöscht");
    let (s, _) = anfrage(&app, "GET", &format!("{PFAD}/{}", ids[1]), &admin, None).await;
    assert_eq!(s, StatusCode::OK, "innerhalb der Frist bleibt sie");
}
