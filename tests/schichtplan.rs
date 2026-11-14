//! Integrationstests des Schichtplans (LLH-1552, Spec `kraefte-schichtplan`): Blöcke an
//! Einheit, UHS und Pause mit Überschneidungsprüfung, Soll aus dem Posten, Prüfbefunde,
//! „Schichten erzeugen“, Grenzwerte, Helfer, Rechte. Die Regeln der Befunde im Einzelnen prüft
//! `src/abloesung/schichtplan/pruefung.rs`.

use axum::http::StatusCode;
use chrono::{Duration, DurationRound, Utc};
use serde_json::{json, Value};

mod common;
use common::*;

fn pfad(einsatz: i64) -> String {
    format!("/api/einsaetze/{einsatz}/abloesungen/schichtplan")
}

async fn uhs_anlegen(app: &axum::Router, cookie: &str, einsatz: i64, name: &str) -> i64 {
    let (s, json) = anfrage_json(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/uhs"),
        cookie,
        Some(&json!({"typ": "behandlungsplatz", "bezeichnung": name})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "UHS: {json:?}");
    json["id"].as_i64().unwrap()
}

async fn quali_id(app: &axum::Router, cookie: &str, label: &str) -> i64 {
    let (_, k) = anfrage(app, "GET", "/api/qualifikationen", cookie, None).await;
    k.as_array()
        .unwrap()
        .iter()
        .find(|q| q["label"] == label)
        .unwrap_or_else(|| panic!("{label} fehlt"))["id"]
        .as_i64()
        .unwrap()
}

async fn stamm_mit_quali(app: &axum::Router, admin: &str, name: &str, quals: &[i64]) -> i64 {
    let (s, json) = anfrage_json(
        app,
        "POST",
        "/api/personal",
        admin,
        Some(&json!({"name": name, "qualifikation_ids": quals})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{json:?}");
    json["id"].as_i64().unwrap()
}

async fn disponieren(app: &axum::Router, cookie: &str, einsatz: i64, personal_id: i64) -> i64 {
    let (s, json) = anfrage_json(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personal"),
        cookie,
        Some(&json!({"personal_id": personal_id})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{json:?}");
    json["id"].as_i64().unwrap()
}

async fn block(app: &axum::Router, cookie: &str, einsatz: i64, body: Value) -> (StatusCode, Value) {
    anfrage_json(
        app,
        "POST",
        &format!("{}/bloecke", pfad(einsatz)),
        cookie,
        Some(&body),
    )
    .await
}

/// Der Block mit dieser Zeit am Posten aus der Antwort.
fn finde<'a>(plan: &'a Value, posten_art: &str, von: &str) -> &'a Value {
    plan["bloecke"]
        .as_array()
        .unwrap()
        .iter()
        .find(|b| b["posten"]["art"] == posten_art && b["von"] == von)
        .unwrap_or_else(|| panic!("Block {posten_art} {von} fehlt: {plan}"))
}

fn befund_arten(befunde: &Value) -> Vec<String> {
    befunde
        .as_array()
        .unwrap()
        .iter()
        .map(|b| b["art"].as_str().unwrap().to_string())
        .collect()
}

fn person<'a>(block: &'a Value, schluessel: &str, id: i64) -> &'a Value {
    block["personen"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p[schluessel] == id)
        .unwrap_or_else(|| panic!("Person {schluessel}={id} fehlt: {block}"))
}

#[tokio::test]
async fn bloecke_an_einheit_uhs_und_pause_ohne_ueberschneidung() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let rtw = einheit_bilden(&app, &admin, e, "RTW 1").await;
    let markt = uhs_anlegen(&app, &admin, e, "UHS Markt").await;
    let etb_vorher = system_etb_anzahl(&app, &admin, e).await;

    let (s, plan) = block(
        &app,
        &admin,
        e,
        json!({"posten": {"art": "einheit", "einheit_id": rtw},
               "von": "2026-11-06 10:00:00", "bis": "2026-11-06 12:00:00", "notiz": " Abend "}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{plan}");
    let erster = finde(&plan, "einheit", "2026-11-06 10:00:00");
    assert_eq!(erster["posten"]["bezeichnung"], "RTW 1");
    assert_eq!(erster["notiz"], "Abend");
    assert_eq!(erster["version"], 1);
    let erster_id = erster["id"].as_i64().unwrap();
    assert_eq!(plan["grenzwerte"]["max_dienst_minuten"], 720);
    assert_eq!(plan["grenzwerte"]["min_ruhe_minuten"], 480);

    // Überschneidung am selben Posten: 422; Anschluss ohne Lücke ist erlaubt.
    let (s, json) = block(
        &app,
        &admin,
        e,
        json!({"posten": {"art": "einheit", "einheit_id": rtw},
               "von": "2026-11-06 11:00:00", "bis": "2026-11-06 13:00:00"}),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{json}");
    let (s, plan) = block(
        &app,
        &admin,
        e,
        json!({"posten": {"art": "einheit", "einheit_id": rtw},
               "von": "2026-11-06 12:00:00", "bis": "2026-11-06 14:00:00"}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{plan}");
    let zweiter = finde(&plan, "einheit", "2026-11-06 12:00:00");
    let zweiter_id = zweiter["id"].as_i64().unwrap();

    // Dieselbe Zeit an der UHS und zweimal in der Pause ist erlaubt.
    let (s, _) = block(
        &app,
        &admin,
        e,
        json!({"posten": {"art": "uhs", "uhs_id": markt},
               "von": "2026-11-06 11:00:00", "bis": "2026-11-06 13:00:00"}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    for _ in 0..2 {
        let (s, json) = block(
            &app,
            &admin,
            e,
            json!({"posten": {"art": "pause"},
                   "von": "2026-11-06 10:30:00", "bis": "2026-11-06 11:00:00"}),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{json}");
    }
    // Pause ohne Soll.
    let (s, _) = block(
        &app,
        &admin,
        e,
        json!({"posten": {"art": "pause"}, "soll_anzahl": 2,
               "von": "2026-11-06 15:00:00", "bis": "2026-11-06 16:00:00"}),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);

    // Feldprüfungen: Raster, Länge, Art, unbekanntes Feld → 400.
    for body in [
        json!({"posten": {"art": "pause"}, "von": "2026-11-06 15:03:00", "bis": "2026-11-06 16:00:00"}),
        json!({"posten": {"art": "pause"}, "von": "2026-11-06 15:00:00", "bis": "2026-11-06 15:05:00"}),
        json!({"posten": {"art": "pause"}, "von": "2026-11-06 15:00:00", "bis": "2026-11-07 15:05:00"}),
        json!({"posten": {"art": "zelt"}, "von": "2026-11-06 15:00:00", "bis": "2026-11-06 16:00:00"}),
        json!({"posten": {"art": "einheit"}, "von": "2026-11-06 15:00:00", "bis": "2026-11-06 16:00:00"}),
        json!({"posten": {"art": "pause"}, "von": "2026-11-06 15:00:00", "bis": "2026-11-06 16:00:00", "farbe": "rot"}),
        json!({"posten": {"art": "pause"}, "von": "2026-11-06 15:00:00", "bis": "2026-11-06 16:00:00", "notiz": "x".repeat(501)}),
    ] {
        let (s, json) = block(&app, &admin, e, body.clone()).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{body} → {json}");
    }
    // Fremder Posten: 422.
    let anderer = einsatz_anlegen(&app, &admin).await;
    let fremd = einheit_bilden(&app, &admin, anderer, "RTW fremd").await;
    let (s, _) = block(
        &app,
        &admin,
        e,
        json!({"posten": {"art": "einheit", "einheit_id": fremd},
               "von": "2026-11-06 15:00:00", "bis": "2026-11-06 16:00:00"}),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);

    // Verschieben in eine andere Zeile: in die UHS überschneidet → 422, in die Pause gelingt.
    let block_pfad = format!("{}/bloecke/{zweiter_id}", pfad(e));
    let (s, _) = anfrage_json(
        &app,
        "PATCH",
        &block_pfad,
        &admin,
        Some(&json!({"version": 1, "posten": {"art": "uhs", "uhs_id": markt}})),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
    let (s, plan) = anfrage_json(
        &app,
        "PATCH",
        &block_pfad,
        &admin,
        Some(&json!({"version": 1, "posten": {"art": "pause"}, "bis": "2026-11-06 12:30:00"})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{plan}");
    let verschoben = finde(&plan, "pause", "2026-11-06 12:00:00");
    assert_eq!(verschoben["version"], 2);
    assert_eq!(verschoben["bis"], "2026-11-06 12:30:00");
    // Alter Stand: 409. Ohne version: 400.
    let (s, _) = anfrage_json(
        &app,
        "PATCH",
        &block_pfad,
        &admin,
        Some(&json!({"version": 1, "notiz": "x"})),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
    let (s, _) = anfrage_json(
        &app,
        "PATCH",
        &block_pfad,
        &admin,
        Some(&json!({"notiz": "x"})),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    // Zurück in die Einheit an die alte Stelle, jetzt mit Lücke: gelingt.
    let (s, _) = anfrage_json(
        &app,
        "PATCH",
        &block_pfad,
        &admin,
        Some(&json!({"version": 2, "posten": {"art": "einheit", "einheit_id": rtw}})),
    )
    .await;
    assert_eq!(s, StatusCode::OK);

    // Löschen mit CAS.
    let loeschen = format!("{}/bloecke/{erster_id}", pfad(e));
    assert_eq!(
        anfrage(&app, "DELETE", &loeschen, &admin, None).await.0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        anfrage(
            &app,
            "DELETE",
            &format!("{loeschen}?version=7"),
            &admin,
            None
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        anfrage(
            &app,
            "DELETE",
            &format!("{loeschen}?version=1"),
            &admin,
            None
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    let (s, plan) = anfrage(&app, "GET", &pfad(e), &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(plan["bloecke"].as_array().unwrap().len(), 4);
    // Einzelne Blöcke schreiben kein ETB.
    assert_eq!(system_etb_anzahl(&app, &admin, e).await, etb_vorher);
}

#[tokio::test]
async fn soll_aus_dem_posten_und_qualifikationsbefund() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let rs = quali_id(&app, &admin, "Rettungssanitäter").await;
    let san = quali_id(&app, &admin, "Sanitäter").await;
    let ns = quali_id(&app, &admin, "Notfallsanitäter").await;
    let markt = uhs_anlegen(&app, &admin, e, "UHS Markt").await;
    let (s, _) = anfrage_json(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{e}/uhs/{markt}"),
        &admin,
        Some(&json!({"soll_anzahl": 1, "quali_soll": [{"qualifikation_id": rs, "anzahl": 1}]})),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let anna = stamm_mit_quali(&app, &admin, "Anna", &[san]).await;
    let nora = stamm_mit_quali(&app, &admin, "Nora", &[ns]).await;

    // Das Soll ist eine Kopie der Vorgabe; mit einer Sanitäterin fehlt Rettungssanitäter.
    let (s, plan) = block(
        &app,
        &admin,
        e,
        json!({"posten": {"art": "uhs", "uhs_id": markt},
               "von": "2026-11-06 10:00:00", "bis": "2026-11-06 12:00:00",
               "personen": [{"art": "stamm", "personal_id": anna}]}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{plan}");
    let b = finde(&plan, "uhs", "2026-11-06 10:00:00");
    assert_eq!(b["soll_anzahl"], 1);
    assert_eq!(b["quali_soll"][0]["qualifikation_id"], rs);
    assert_eq!(b["offene_plaetze"], 0);
    assert_eq!(b["offene_anforderungen"][0]["qualifikation_id"], rs);
    let quali: Vec<&Value> = b["befunde"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|f| f["art"] == "quali")
        .collect();
    assert_eq!(quali.len(), 1, "{b}");
    assert_eq!(quali[0]["qualifikation_id"], rs);
    let bid = b["id"].as_i64().unwrap();

    // Eine Notfallsanitäterin deckt Rettungssanitäter über den Einschluss.
    let (s, plan) = anfrage_json(
        &app,
        "PATCH",
        &format!("{}/bloecke/{bid}", pfad(e)),
        &admin,
        Some(&json!({"version": 1, "personen": [{"art": "stamm", "personal_id": nora}]})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{plan}");
    let b = finde(&plan, "uhs", "2026-11-06 10:00:00");
    assert!(b["offene_anforderungen"].as_array().unwrap().is_empty());
    assert!(!befund_arten(&b["befunde"]).contains(&"quali".to_string()));
    assert_eq!(
        person(b, "personal_id", nora)["qualifikationen"],
        json!([ns])
    );

    // Eigenes Soll im Block und „kein Soll“.
    let (s, plan) = block(
        &app,
        &admin,
        e,
        json!({"posten": {"art": "uhs", "uhs_id": markt}, "soll_anzahl": null, "quali_soll": null,
               "von": "2026-11-06 12:00:00", "bis": "2026-11-06 14:00:00"}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    let b = finde(&plan, "uhs", "2026-11-06 12:00:00");
    assert!(b["soll_anzahl"].is_null());
    assert!(b["quali_soll"].is_null());
    assert_eq!(b["offene_plaetze"], 0);
}

#[tokio::test]
async fn befunde_doppelt_dienst_abweichung_und_person_ausserhalb_des_einsatzes() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let rtw = einheit_bilden(&app, &admin, e, "RTW 1").await;
    let markt = uhs_anlegen(&app, &admin, e, "UHS Markt").await;
    let anna = stamm_mit_quali(&app, &admin, "Anna", &[]).await;
    let anna_ep = disponieren(&app, &admin, e, anna).await;
    let bernd = stamm_mit_quali(&app, &admin, "Bernd", &[]).await; // nicht disponiert
    let (s, cem) = anfrage_json(
        &app,
        "POST",
        &format!("{}/helfer", pfad(e)),
        &admin,
        Some(&json!({"name": "Cem", "telefon": "0170 1", "organisation": "THW"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{cem}");
    let cem = cem["id"].as_i64().unwrap();
    let (_, kraefte_vorher) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/personal"),
        &admin,
        None,
    )
    .await;

    // Jetzt läuft ein Block am RTW (seit 30 min), Anna, Bernd und Cem sind eingeteilt.
    let jetzt = Utc::now().duration_trunc(Duration::minutes(5)).unwrap();
    let f = |t: chrono::DateTime<Utc>| t.format("%Y-%m-%d %H:%M:%S").to_string();
    let (von, bis) = (
        f(jetzt - Duration::minutes(30)),
        f(jetzt + Duration::minutes(60)),
    );
    let (s, plan) = block(
        &app,
        &admin,
        e,
        json!({"posten": {"art": "einheit", "einheit_id": rtw}, "von": von, "bis": bis,
               "personen": [{"art": "stamm", "personal_id": anna},
                            {"art": "stamm", "personal_id": bernd},
                            {"art": "helfer", "helfer_id": cem},
                            {"art": "stamm", "personal_id": anna}]}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{plan}");
    let b = finde(&plan, "einheit", &von);
    assert_eq!(b["personen_anzahl"], 3, "entdoppelt");
    let a = person(b, "personal_id", anna);
    assert_eq!(a["im_einsatz"], true);
    assert_eq!(befund_arten(&a["befunde"]), ["abweichung"]);
    let bp = person(b, "personal_id", bernd);
    assert_eq!(bp["im_einsatz"], false);
    assert_eq!(bp["name"], "Bernd");
    assert!(befund_arten(&bp["befunde"]).contains(&"abweichung".to_string()));
    let cp = person(b, "helfer_id", cem);
    assert_eq!(cp["im_einsatz"], false);
    assert_eq!(cp["name"], "Cem");
    assert!(plan["naechste_pruefung_at"].is_string());
    assert_eq!(plan["helfer"][0]["organisation"], "THW");

    // Wer nur im Plan steht, ist nicht im Einsatz: die Kräfteliste bleibt, wie sie war.
    let (_, kraefte) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/personal"),
        &admin,
        None,
    )
    .await;
    assert_eq!(kraefte, kraefte_vorher);

    // Anna ist am Posten → kein Befund mehr.
    sqlx::query("UPDATE einsatz_personal SET einheit_id = ? WHERE id = ?")
        .bind(rtw)
        .bind(anna_ep)
        .execute(&pool)
        .await
        .unwrap();
    let (_, plan) = anfrage(&app, "GET", &pfad(e), &admin, None).await;
    let b = finde(&plan, "einheit", &von);
    assert!(befund_arten(&person(b, "personal_id", anna)["befunde"]).is_empty());

    // Doppelt verplant: Anna zugleich an der UHS.
    let (s, plan) = block(
        &app,
        &admin,
        e,
        json!({"posten": {"art": "uhs", "uhs_id": markt}, "von": von, "bis": bis,
               "personen": [{"art": "stamm", "personal_id": anna}]}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    let b = finde(&plan, "einheit", &von);
    let a = person(b, "personal_id", anna);
    assert!(
        befund_arten(&a["befunde"]).contains(&"doppelt".to_string()),
        "{a}"
    );

    // Zu lange im Dienst: Höchstwert 60 min, der Block dauert 90 min.
    let (s, plan) = anfrage_json(
        &app,
        "PATCH",
        &format!("{}/grenzwerte", pfad(e)),
        &admin,
        Some(&json!({"max_dienst_minuten": 60})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{plan}");
    let b = finde(&plan, "einheit", &von);
    let dienst: Vec<&Value> = person(b, "personal_id", anna)["befunde"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|f| f["art"] == "dienst")
        .collect();
    assert_eq!(dienst.len(), 1);
    assert_eq!(dienst[0]["dauer_minuten"], 90);
}

#[tokio::test]
async fn personen_und_helfer_pruefen() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let rs = quali_id(&app, &admin, "Rettungssanitäter").await;
    let anna_ep = stammpersonal_disponieren(&app, &admin, e, "Anna").await;
    let (s, adhoc) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/personal"),
        &admin,
        Some(
            &json!({"adhoc": {"name": "Notarzt Extern", "funktion": "Notarzt",
                               "staerke_position": "fuehrer"}}),
        ),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    let adhoc = adhoc["id"].as_i64().unwrap();
    let (fremd_org, _) = fremde_org_anlegen(&pool, "Andere", "fremd", "fremdpw12", "keine").await;
    let fremde_person: i64 =
        sqlx::query_scalar("INSERT INTO personal (org_id, name) VALUES (?, 'Fremd') RETURNING id")
            .bind(fremd_org)
            .fetch_one(&pool)
            .await
            .unwrap();
    let fremde_quali: i64 = sqlx::query_scalar(
        "INSERT INTO qualifikation (org_id, label) VALUES (?, 'Fremd') RETURNING id",
    )
    .bind(fremd_org)
    .fetch_one(&pool)
    .await
    .unwrap();

    let zeit = json!({"posten": {"art": "pause"},
                      "von": "2026-11-06 10:00:00", "bis": "2026-11-06 11:00:00"});
    let mit = |personen: Value| {
        let mut b = zeit.clone();
        b["personen"] = personen;
        b
    };
    // Ad-hoc-Kraft ja; disponiertes Stamm-Personal nur über personal_id; fremde Org nein.
    let (s, plan) = block(
        &app,
        &admin,
        e,
        mit(json!([{"art": "einsatz", "einsatz_personal_id": adhoc}])),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{plan}");
    assert_eq!(plan["bloecke"][0]["personen"][0]["name"], "Notarzt Extern");
    for (personen, was) in [
        (
            json!([{"art": "einsatz", "einsatz_personal_id": anna_ep}]),
            "nicht ad hoc",
        ),
        (
            json!([{"art": "stamm", "personal_id": fremde_person}]),
            "fremde Org",
        ),
        (
            json!([{"art": "helfer", "helfer_id": 987654}]),
            "unbekannter Helfer",
        ),
    ] {
        let (s, json) = block(&app, &admin, e, mit(personen)).await;
        assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{was}: {json}");
    }
    let viele: Vec<Value> = (1..=51)
        .map(|i| json!({"art": "stamm", "personal_id": i}))
        .collect();
    let (s, _) = block(&app, &admin, e, mit(json!(viele))).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);

    // Helfer: Pflichtname, Grenzen, Qualifikationen der eigenen Organisation.
    let helfer = format!("{}/helfer", pfad(e));
    for (body, status) in [
        (json!({"name": "  "}), StatusCode::BAD_REQUEST),
        (json!({"name": "x".repeat(201)}), StatusCode::BAD_REQUEST),
        (
            json!({"name": "Cem", "telefon": "1".repeat(51)}),
            StatusCode::BAD_REQUEST,
        ),
        (
            json!({"name": "Cem", "qualifikationen": (1..=21).collect::<Vec<i64>>()}),
            StatusCode::BAD_REQUEST,
        ),
        (
            json!({"name": "Cem", "qualifikationen": [fremde_quali]}),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
    ] {
        let (s, json) = anfrage_json(&app, "POST", &helfer, &admin, Some(&body)).await;
        assert_eq!(s, status, "{body} → {json}");
    }
    let (s, cem) = anfrage_json(
        &app,
        "POST",
        &helfer,
        &admin,
        Some(&json!({"name": " Cem ", "qualifikationen": [rs, rs]})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    assert_eq!(cem["name"], "Cem");
    assert_eq!(cem["qualifikationen"], json!([rs]));
    let cem_id = cem["id"].as_i64().unwrap();
    let (s, cem) = anfrage_json(
        &app,
        "PATCH",
        &format!("{helfer}/{cem_id}"),
        &admin,
        Some(&json!({"telefon": "0170 2", "organisation": null})),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(cem["telefon"], "0170 2");
    assert_eq!(cem["name"], "Cem");

    // Im Block; Löschen nimmt ihn aus allen Blöcken.
    let mut b = mit(json!([{"art": "helfer", "helfer_id": cem_id}]));
    b["von"] = json!("2026-11-06 12:00:00");
    b["bis"] = json!("2026-11-06 13:00:00");
    let (s, _) = block(&app, &admin, e, b).await;
    assert_eq!(s, StatusCode::CREATED);
    assert_eq!(
        anfrage(&app, "DELETE", &format!("{helfer}/{cem_id}"), &admin, None)
            .await
            .0,
        StatusCode::NO_CONTENT
    );
    let (_, plan) = anfrage(&app, "GET", &pfad(e), &admin, None).await;
    let b = finde(&plan, "pause", "2026-11-06 12:00:00");
    assert_eq!(b["personen_anzahl"], 0);
    assert!(plan["helfer"].as_array().unwrap().is_empty());
}

#[tokio::test]
async fn schichten_erzeugen_aus_laenge_und_schichtmodell() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let markt = uhs_anlegen(&app, &admin, e, "UHS Markt").await;
    let erzeugen = format!("{}/erzeugen", pfad(e));
    let posten = json!({"art": "uhs", "uhs_id": markt});

    // Ohne Schichtmodell und ohne Länge: 422; Länge außerhalb: 400.
    let (s, _) = anfrage_json(
        &app,
        "POST",
        &erzeugen,
        &admin,
        Some(
            &json!({"posten": posten, "von": "2026-11-06 14:00:00", "bis": "2026-11-06 20:00:00"}),
        ),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
    for laenge in [5, 1445, 62] {
        let (s, _) = anfrage_json(
            &app,
            "POST",
            &erzeugen,
            &admin,
            Some(&json!({"posten": posten, "von": "2026-11-06 14:00:00",
                         "bis": "2026-11-06 20:00:00", "laenge_minuten": laenge})),
        )
        .await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{laenge}");
    }
    // Zeitraum unter 10 min: 400 (länger als 24 h ist erlaubt, siehe unten).
    let (s, _) = anfrage_json(
        &app,
        "POST",
        &erzeugen,
        &admin,
        Some(&json!({"posten": posten, "von": "2026-11-06 10:00:00",
                     "bis": "2026-11-06 10:05:00", "laenge_minuten": 10})),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    // Mehr als 100 Schichten: 400.
    let (s, _) = anfrage_json(
        &app,
        "POST",
        &erzeugen,
        &admin,
        Some(&json!({"posten": posten, "von": "2026-11-06 00:00:00",
                     "bis": "2026-11-08 00:00:00", "laenge_minuten": 10})),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);

    // 6 h in 2-h-Schichten: drei Blöcke, ein ETB-Satz.
    let (s, plan) = anfrage_json(
        &app,
        "POST",
        &erzeugen,
        &admin,
        Some(&json!({"posten": posten, "von": "2026-11-06 14:00:00",
                     "bis": "2026-11-06 20:00:00", "laenge_minuten": 120})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{plan}");
    assert_eq!(plan["bloecke"].as_array().unwrap().len(), 3);
    let etb = system_etb_inhalte(&app, &admin, e).await;
    assert!(
        etb.iter()
            .any(|i| i.contains("Schichtplan UHS «UHS Markt»: 3 Schichten")),
        "{etb:?}"
    );

    // Überschneidung mit Bestehendem: alles oder nichts, Zeilen nennen die Blöcke.
    let (s, json) = anfrage_json(
        &app,
        "POST",
        &erzeugen,
        &admin,
        Some(&json!({"posten": posten, "von": "2026-11-06 19:00:00",
                     "bis": "2026-11-06 23:00:00", "laenge_minuten": 60})),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{json}");
    assert_eq!(json["zeilen"][0]["art"], "planschicht");
    let (_, plan) = anfrage(&app, "GET", &pfad(e), &admin, None).await;
    assert_eq!(plan["bloecke"].as_array().unwrap().len(), 3);

    // Mit Schichtmodell (Rhythmus 4 h) ohne Länge: 8 h in zwei Blöcke an der Pause.
    let (s, json) = anfrage_json(
        &app,
        "PUT",
        &format!("/api/einsaetze/{e}/abloesungen/schichtmodell"),
        &admin,
        Some(
            &json!({"schichtmodell": {"bezeichnung": "4 h", "typ": "rhythmus",
                                       "rhythmus_minuten": 240}}),
        ),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{json}");
    let (s, plan) = anfrage_json(
        &app,
        "POST",
        &erzeugen,
        &admin,
        Some(
            &json!({"posten": {"art": "pause"}, "von": "2026-11-06 14:00:00",
                     "bis": "2026-11-06 22:00:00"}),
        ),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{plan}");
    let pausen: Vec<&Value> = plan["bloecke"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|b| b["posten"]["art"] == "pause")
        .collect();
    assert_eq!(pausen.len(), 2);
    assert_eq!(pausen[1]["von"], "2026-11-06 18:00:00");
}

/// Die Zeilen eines 422 als Paare (Kennung, Grund).
fn zeilen(json: &Value) -> Vec<(i64, String)> {
    json["zeilen"]
        .as_array()
        .unwrap_or_else(|| panic!("ohne Zeilen: {json}"))
        .iter()
        .map(|z| {
            assert_eq!(z["art"], "planschicht", "{z}");
            (
                z["id"].as_i64().unwrap(),
                z["grund"].as_str().unwrap().to_string(),
            )
        })
        .collect()
}

/// LLH-1594: Eine erzeugte Schicht nennt jeden Block, mit dem sie sich überschneidet, nicht nur
/// den frühesten; ein Block, den mehrere erzeugte Schichten treffen, steht einmal da.
#[tokio::test]
async fn schichten_erzeugen_nennt_jeden_ueberschnittenen_block_einmal() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let markt = uhs_anlegen(&app, &admin, e, "UHS Markt").await;
    let posten = json!({"art": "uhs", "uhs_id": markt});
    let erzeugen = format!("{}/erzeugen", pfad(e));

    let mut ids = Vec::new();
    for (von, bis) in [
        ("2026-11-06 10:00:00", "2026-11-06 11:00:00"),
        ("2026-11-06 12:00:00", "2026-11-06 14:00:00"),
    ] {
        let (s, plan) = block(
            &app,
            &admin,
            e,
            json!({"posten": posten, "von": von, "bis": bis}),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{plan}");
        ids.push(finde(&plan, "uhs", von)["id"].as_i64().unwrap());
    }

    // Eine Schicht 10–14 über beide Blöcke: zwei Zeilen, früheste zuerst.
    let (s, json) = anfrage_json(
        &app,
        "POST",
        &erzeugen,
        &admin,
        Some(&json!({"posten": posten, "von": "2026-11-06 10:00:00",
                     "bis": "2026-11-06 14:00:00", "laenge_minuten": 240})),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{json}");
    let z = zeilen(&json);
    assert_eq!(
        z.iter().map(|(id, _)| *id).collect::<Vec<_>>(),
        ids,
        "{json}"
    );
    assert!(
        z.iter()
            .all(|(_, g)| g.starts_with("überschneidet sich mit ")),
        "{json}"
    );

    // Vier Schichten zu 1 h: 12–13 und 13–14 treffen denselben Block, er steht einmal da.
    let (s, json) = anfrage_json(
        &app,
        "POST",
        &erzeugen,
        &admin,
        Some(&json!({"posten": posten, "von": "2026-11-06 10:00:00",
                     "bis": "2026-11-06 14:00:00", "laenge_minuten": 60})),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{json}");
    assert_eq!(
        zeilen(&json).iter().map(|(id, _)| *id).collect::<Vec<_>>(),
        ids,
        "{json}"
    );
    let (_, plan) = anfrage(&app, "GET", &pfad(e), &admin, None).await;
    assert_eq!(
        plan["bloecke"].as_array().unwrap().len(),
        2,
        "nichts angelegt"
    );
}

#[tokio::test]
async fn grenzwerte_mit_etb_und_vorgabe() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let grenz = format!("{}/grenzwerte", pfad(e));
    for body in [
        json!({"max_dienst_minuten": 59}),
        json!({"max_dienst_minuten": 1441}),
        json!({"min_ruhe_minuten": -1}),
        json!({"ruhe": 10}),
    ] {
        let (s, _) = anfrage_json(&app, "PATCH", &grenz, &admin, Some(&body)).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{body}");
    }
    let vorher = system_etb_anzahl(&app, &admin, e).await;
    let (s, plan) = anfrage_json(
        &app,
        "PATCH",
        &grenz,
        &admin,
        Some(&json!({"max_dienst_minuten": 600, "min_ruhe_minuten": 0})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{plan}");
    assert_eq!(
        plan["grenzwerte"],
        json!({"max_dienst_minuten": 600, "min_ruhe_minuten": 0,
               "max_dienst_eigen": true, "min_ruhe_eigen": true})
    );
    assert_eq!(system_etb_anzahl(&app, &admin, e).await, vorher + 1);
    // Unverändert: kein neuer Satz.
    let (s, _) = anfrage_json(
        &app,
        "PATCH",
        &grenz,
        &admin,
        Some(&json!({"max_dienst_minuten": 600})),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(system_etb_anzahl(&app, &admin, e).await, vorher + 1);
    // null = Vorgabe.
    let (_, plan) = anfrage_json(
        &app,
        "PATCH",
        &grenz,
        &admin,
        Some(&json!({"max_dienst_minuten": null})),
    )
    .await;
    assert_eq!(plan["grenzwerte"]["max_dienst_minuten"], 720);
    assert_eq!(plan["grenzwerte"]["max_dienst_eigen"], false);
    let etb = system_etb_inhalte(&app, &admin, e).await;
    assert!(etb.iter().any(|i| i.contains("(Vorgabe)")), "{etb:?}");
}

#[tokio::test]
async fn rechte_module_und_abgeschlossener_einsatz() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let rtw = einheit_bilden(&app, &admin, e, "RTW 1").await;
    let anna = stammpersonal_anlegen(&app, &admin, "Anna").await;
    let (s, _) = block(
        &app,
        &admin,
        e,
        json!({"posten": {"art": "pause"}, "von": "2026-11-06 10:00:00",
               "bis": "2026-11-06 11:00:00", "personen": [{"art": "stamm", "personal_id": anna}]}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);

    let fid = benutzer_anlegen(&app, &admin, "frieda", "keine").await;
    rolle_setzen(&app, &admin, e, fid, "fuehrungspersonal").await;
    let frieda = login_cookie(&app, "frieda", "friedapw1").await;
    let bid = benutzer_anlegen(&app, &admin, "bertram", "keine").await;
    rolle_setzen(&app, &admin, e, bid, "beobachter").await;
    let bert = login_cookie(&app, "bertram", "bertrampw1").await;

    // Beobachter liest, schreibt nicht.
    assert_eq!(
        anfrage(&app, "GET", &pfad(e), &bert, None).await.0,
        StatusCode::OK
    );
    let pause = json!({"posten": {"art": "pause"}, "von": "2026-11-06 12:00:00",
                       "bis": "2026-11-06 13:00:00"});
    assert_eq!(
        block(&app, &bert, e, pause.clone()).await.0,
        StatusCode::FORBIDDEN
    );

    // Ohne Personal: keine Namen, keine Helfer; Personen und Helfer schreiben ist 403.
    for modul in ["personal", "einheiten"] {
        let (s, _) = anfrage(
            &app,
            "PUT",
            &format!("/api/einsaetze/{e}/modul-overrides/{modul}"),
            &admin,
            Some(r#"{"sichtbar":false,"benoetigte_rolle":null}"#),
        )
        .await;
        assert_eq!(s, StatusCode::OK);
    }
    let (s, plan) = anfrage(&app, "GET", &pfad(e), &frieda, None).await;
    assert_eq!(s, StatusCode::OK);
    assert!(plan["bloecke"][0]["personen"].is_null(), "{plan}");
    assert_eq!(plan["bloecke"][0]["personen_anzahl"], 1);
    assert!(plan["helfer"].is_null());
    let mut mit_person = pause.clone();
    mit_person["personen"] = json!([{"art": "stamm", "personal_id": anna}]);
    assert_eq!(
        block(&app, &frieda, e, mit_person).await.0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        anfrage_json(
            &app,
            "POST",
            &format!("{}/helfer", pfad(e)),
            &frieda,
            Some(&json!({"name": "Cem"}))
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    // Ohne Einheiten: kein Block an der Einheit, die Pause geht.
    let mut an_einheit = pause.clone();
    an_einheit["posten"] = json!({"art": "einheit", "einheit_id": rtw});
    assert_eq!(
        block(&app, &frieda, e, an_einheit).await.0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        block(&app, &frieda, e, pause.clone()).await.0,
        StatusCode::CREATED
    );
    // Löschen: den belegten Block nur mit Personal, den leeren schon.
    let (_, plan) = anfrage(&app, "GET", &pfad(e), &frieda, None).await;
    let pfad_von = |b: &Value| {
        format!(
            "{}/bloecke/{}?version={}",
            pfad(e),
            b["id"].as_i64().unwrap(),
            b["version"].as_i64().unwrap()
        )
    };
    let belegt = pfad_von(finde(&plan, "pause", "2026-11-06 10:00:00"));
    let leer = pfad_von(finde(&plan, "pause", "2026-11-06 12:00:00"));
    let (s, json) = anfrage(&app, "DELETE", &belegt, &frieda, None).await;
    assert_eq!(s, StatusCode::FORBIDDEN, "{json}");
    assert_eq!(json["error"], "Keine Berechtigung", "{json}");
    assert_eq!(
        anfrage(&app, "DELETE", &leer, &frieda, None).await.0,
        StatusCode::NO_CONTENT
    );

    // Abgeschlossen: lesen ja, schreiben 409.
    let (s, v) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/abschliessen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(
        anfrage(&app, "GET", &pfad(e), &admin, None).await.0,
        StatusCode::OK
    );
    let mut spaeter = pause;
    spaeter["von"] = json!("2026-11-06 14:00:00");
    spaeter["bis"] = json!("2026-11-06 15:00:00");
    assert_eq!(
        block(&app, &admin, e, spaeter).await.0,
        StatusCode::CONFLICT
    );
}

// ---------------------------------------------------------------------------------------------
// Gleichverhalten vor dem gemeinsamen Kern (LLH-1684, Change `y106s29r-blockplan-kern`, tasks.md
// 1.1, 1.3, 1.4): exakte Texte, Codes und Reihenfolgen des Einsatz-Schichtplans. Das Gegenstück
// der Vorplanung steht in `tests/planung.rs`.
// ---------------------------------------------------------------------------------------------

/// Der Fehlertext einer Antwort.
fn fehlertext(json: &Value) -> &str {
    json["error"]
        .as_str()
        .unwrap_or_else(|| panic!("ohne Fehlertext: {json}"))
}

/// Prüft Status und Fehlertext wortgleich.
fn erwarte(antwort: (StatusCode, Value), status: StatusCode, text: &str) {
    let (s, json) = antwort;
    assert_eq!(s, status, "{json}");
    assert_eq!(fehlertext(&json), text, "{json}");
}

/// Setzt Zone und Darstellung von Einsatz und Organisation verschieden: der Einsatz New York
/// taktisch, die Organisation Tokio „Datum und Uhrzeit“.
async fn zeitstil_verschieden(pool: &sqlx::SqlitePool, einsatz: i64) {
    sqlx::query(
        "INSERT INTO einsatz_einstellungen (einsatz_id, zeitzone, zeitdarstellung) \
         VALUES (?, 'America/New_York', 'taktisch') \
         ON CONFLICT(einsatz_id) DO UPDATE SET zeitzone = excluded.zeitzone, \
            zeitdarstellung = excluded.zeitdarstellung",
    )
    .bind(einsatz)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO org_einstellungen (org_id, zeitzone, zeitdarstellung) \
         SELECT org_id, 'Asia/Tokyo', 'datum_uhrzeit' FROM einsatz WHERE id = ? \
         ON CONFLICT(org_id) DO UPDATE SET zeitzone = excluded.zeitzone, \
            zeitdarstellung = excluded.zeitdarstellung",
    )
    .bind(einsatz)
    .execute(pool)
    .await
    .unwrap();
}

/// Überschneidung (Anlegen, Ändern, Erzeugen) nennt den Zeitraum in Zone und Darstellung des
/// Einsatzes, nicht der Organisation; der CAS-Text gilt für Ändern und Löschen.
#[tokio::test]
async fn ueberschneidung_nennt_die_zeit_des_einsatzes_und_cas_text_ist_wortgleich() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    zeitstil_verschieden(&pool, e).await;
    let rtw = einheit_bilden(&app, &admin, e, "RTW 1").await;
    let posten = json!({"art": "einheit", "einheit_id": rtw});

    let (s, plan) = block(
        &app,
        &admin,
        e,
        json!({"posten": posten, "von": "2026-11-06 10:00:00", "bis": "2026-11-06 12:00:00"}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{plan}");
    let erster = finde(&plan, "einheit", "2026-11-06 10:00:00")["id"]
        .as_i64()
        .unwrap();
    // 10:00–12:00 UTC ist in New York (EST) 05:00–07:00; Tokio wäre „06.11.26 19:00–21:00“.
    let text = "Die Schicht überschneidet sich mit 060500nov26–0700";
    erwarte(
        block(
            &app,
            &admin,
            e,
            json!({"posten": posten, "von": "2026-11-06 11:00:00", "bis": "2026-11-06 13:00:00"}),
        )
        .await,
        StatusCode::UNPROCESSABLE_ENTITY,
        text,
    );

    let (s, plan) = block(
        &app,
        &admin,
        e,
        json!({"posten": posten, "von": "2026-11-06 14:00:00", "bis": "2026-11-06 15:00:00"}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{plan}");
    let zweiter = finde(&plan, "einheit", "2026-11-06 14:00:00")["id"]
        .as_i64()
        .unwrap();
    let zweiter_pfad = format!("{}/bloecke/{zweiter}", pfad(e));
    erwarte(
        anfrage_json(
            &app,
            "PATCH",
            &zweiter_pfad,
            &admin,
            Some(
                &json!({"version": 1, "von": "2026-11-06 11:00:00", "bis": "2026-11-06 15:00:00"}),
            ),
        )
        .await,
        StatusCode::UNPROCESSABLE_ENTITY,
        text,
    );

    // Erzeugen: Sammeltext und je Block der Grund, in derselben Zeit des Einsatzes.
    let (s, json) = anfrage_json(
        &app,
        "POST",
        &format!("{}/erzeugen", pfad(e)),
        &admin,
        Some(&json!({"posten": posten, "von": "2026-11-06 09:00:00",
                     "bis": "2026-11-06 11:00:00", "laenge_minuten": 60})),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{json}");
    assert_eq!(
        fehlertext(&json),
        "Erzeugte Schichten überschneiden sich mit bestehenden; nichts angelegt"
    );
    assert_eq!(
        zeilen(&json),
        vec![(
            erster,
            "überschneidet sich mit 060500nov26–0700".to_string()
        )]
    );

    // CAS: Ändern und Löschen mit altem Stand.
    let cas = "Die Schicht wurde zwischenzeitlich geändert";
    erwarte(
        anfrage_json(
            &app,
            "PATCH",
            &zweiter_pfad,
            &admin,
            Some(&json!({"version": 2, "notiz": "x"})),
        )
        .await,
        StatusCode::CONFLICT,
        cas,
    );
    erwarte(
        anfrage(
            &app,
            "DELETE",
            &format!("{zweiter_pfad}?version=2"),
            &admin,
            None,
        )
        .await,
        StatusCode::CONFLICT,
        cas,
    );
}

/// Pause ohne Soll, Posten, Personen, Helfer und Qualifikationen: jeder 422 mit seinem Text.
#[tokio::test]
async fn texte_zu_soll_posten_personen_und_qualifikationen_sind_wortgleich() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let anderer = einsatz_anlegen(&app, &admin).await;
    let rtw = einheit_bilden(&app, &admin, e, "RTW 1").await;
    let alt = einheit_bilden(&app, &admin, e, "RTW alt").await;
    let fremde_einheit = einheit_bilden(&app, &admin, anderer, "RTW fremd").await;
    let markt = uhs_anlegen(&app, &admin, e, "UHS Markt").await;
    let zu = uhs_anlegen(&app, &admin, e, "UHS zu").await;
    let fremde_uhs = uhs_anlegen(&app, &admin, anderer, "UHS fremd").await;
    sqlx::query("UPDATE einsatz_einheit SET aufgeloest_at = '2026-11-06 08:00:00' WHERE id = ?")
        .bind(alt)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE uhs SET status = 'aufgeloest' WHERE id = ?")
        .bind(zu)
        .execute(&pool)
        .await
        .unwrap();
    let anna_ep = stammpersonal_disponieren(&app, &admin, e, "Anna").await;
    let (fremd_org, _) = fremde_org_anlegen(&pool, "Andere", "fremd", "fremdpw12", "keine").await;
    let fremde_person: i64 =
        sqlx::query_scalar("INSERT INTO personal (org_id, name) VALUES (?, 'Fremd') RETURNING id")
            .bind(fremd_org)
            .fetch_one(&pool)
            .await
            .unwrap();
    let fremde_quali: i64 = sqlx::query_scalar(
        "INSERT INTO qualifikation (org_id, label) VALUES (?, 'Fremd') RETURNING id",
    )
    .bind(fremd_org)
    .fetch_one(&pool)
    .await
    .unwrap();
    let (s, fremder_helfer) = anfrage_json(
        &app,
        "POST",
        &format!("{}/helfer", pfad(anderer)),
        &admin,
        Some(&json!({"name": "Finn"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{fremder_helfer}");

    let zeit = |posten: Value| json!({"posten": posten, "von": "2026-11-06 10:00:00", "bis": "2026-11-06 11:00:00"});
    let mit = |mut body: Value, feld: &str, wert: Value| {
        body[feld] = wert;
        body
    };
    let pause = json!({"art": "pause"});
    let faelle = [
        (
            mit(zeit(pause.clone()), "soll_anzahl", json!(2)),
            "Die Pause hat kein Soll",
        ),
        (
            zeit(json!({"art": "einheit", "einheit_id": fremde_einheit})),
            "Die Einheit gehört nicht zu diesem Einsatz",
        ),
        (
            zeit(json!({"art": "einheit", "einheit_id": alt})),
            "Die Einheit ist aufgelöst",
        ),
        (
            zeit(json!({"art": "uhs", "uhs_id": fremde_uhs})),
            "Die UHS gehört nicht zu diesem Einsatz",
        ),
        (
            zeit(json!({"art": "uhs", "uhs_id": zu})),
            "Die UHS ist aufgelöst",
        ),
        (
            mit(
                zeit(json!({"art": "uhs", "uhs_id": markt})),
                "quali_soll",
                json!([{"qualifikation_id": fremde_quali, "anzahl": 1}]),
            ),
            "Qualifikation im Soll gehört nicht zur Organisation",
        ),
        (
            mit(
                zeit(pause.clone()),
                "personen",
                json!([{"art": "stamm", "personal_id": fremde_person}]),
            ),
            "Eine Person gehört nicht zur Organisation",
        ),
        (
            mit(
                zeit(pause.clone()),
                "personen",
                json!([{"art": "einsatz", "einsatz_personal_id": anna_ep}]),
            ),
            "Über einsatz_personal_id nur Ad-hoc-Kräfte dieses Einsatzes; Stamm-Personal über \
             personal_id",
        ),
        (
            mit(
                zeit(pause.clone()),
                "personen",
                json!([{"art": "helfer", "helfer_id": fremder_helfer["id"]}]),
            ),
            "Ein Helfer gehört nicht zu diesem Einsatz",
        ),
    ];
    for (body, text) in faelle {
        erwarte(
            block(&app, &admin, e, body).await,
            StatusCode::UNPROCESSABLE_ENTITY,
            text,
        );
    }

    // Dieselben Texte beim Ändern: Soll an der Pause, Posten, Personen, Soll-Qualifikation.
    let (s, plan) = block(&app, &admin, e, zeit(pause.clone())).await;
    assert_eq!(s, StatusCode::CREATED, "{plan}");
    let bid = finde(&plan, "pause", "2026-11-06 10:00:00")["id"]
        .as_i64()
        .unwrap();
    let block_pfad = format!("{}/bloecke/{bid}", pfad(e));
    for (body, text) in [
        (
            json!({"version": 1, "soll_anzahl": 3}),
            "Die Pause hat kein Soll",
        ),
        (
            json!({"version": 1, "posten": {"art": "einheit", "einheit_id": fremde_einheit}}),
            "Die Einheit gehört nicht zu diesem Einsatz",
        ),
        (
            json!({"version": 1, "posten": {"art": "uhs", "uhs_id": zu}}),
            "Die UHS ist aufgelöst",
        ),
        (
            json!({"version": 1, "posten": {"art": "einheit", "einheit_id": rtw},
                   "quali_soll": [{"qualifikation_id": fremde_quali, "anzahl": 1}]}),
            "Qualifikation im Soll gehört nicht zur Organisation",
        ),
        (
            json!({"version": 1, "personen": [{"art": "helfer", "helfer_id": fremder_helfer["id"]}]}),
            "Ein Helfer gehört nicht zu diesem Einsatz",
        ),
    ] {
        erwarte(
            anfrage_json(&app, "PATCH", &block_pfad, &admin, Some(&body)).await,
            StatusCode::UNPROCESSABLE_ENTITY,
            text,
        );
    }

    // Fremde Qualifikation am Helfer: beim Anlegen und beim Ändern.
    let helfer = format!("{}/helfer", pfad(e));
    let quali_text = "Qualifikation gehört nicht zur Organisation";
    erwarte(
        anfrage_json(
            &app,
            "POST",
            &helfer,
            &admin,
            Some(&json!({"name": "Cem", "qualifikationen": [fremde_quali]})),
        )
        .await,
        StatusCode::UNPROCESSABLE_ENTITY,
        quali_text,
    );
    let (s, cem) = anfrage_json(&app, "POST", &helfer, &admin, Some(&json!({"name": "Cem"}))).await;
    assert_eq!(s, StatusCode::CREATED, "{cem}");
    erwarte(
        anfrage_json(
            &app,
            "PATCH",
            &format!("{helfer}/{}", cem["id"]),
            &admin,
            Some(&json!({"qualifikationen": [fremde_quali]})),
        )
        .await,
        StatusCode::UNPROCESSABLE_ENTITY,
        quali_text,
    );
}

/// „Schichten erzeugen“ ohne Länge und ohne Schichtmodell des Einsatzes.
#[tokio::test]
async fn erzeugen_ohne_laenge_und_schichtmodell_nennt_den_einsatz() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let markt = uhs_anlegen(&app, &admin, e, "UHS Markt").await;
    erwarte(
        anfrage_json(
            &app,
            "POST",
            &format!("{}/erzeugen", pfad(e)),
            &admin,
            Some(&json!({"posten": {"art": "uhs", "uhs_id": markt},
                         "von": "2026-11-06 14:00:00", "bis": "2026-11-06 20:00:00"})),
        )
        .await,
        StatusCode::UNPROCESSABLE_ENTITY,
        "Der Einsatz hat kein Schichtmodell; bitte eine Länge angeben",
    );
}

/// Kurzform eines Blocks zum Vergleichen der Reihenfolge: Art, Bezeichnung, Beginn.
fn reihe(plan: &Value) -> Vec<(String, String, String)> {
    plan["bloecke"]
        .as_array()
        .unwrap()
        .iter()
        .map(|b| {
            (
                b["posten"]["art"].as_str().unwrap().to_string(),
                b["posten"]["bezeichnung"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string(),
                b["von"].as_str().unwrap()[11..16].to_string(),
            )
        })
        .collect()
}

/// Blöcke nach Art (Einheit, UHS, Pause), Sortierung der Einheit, Name, dann Beginn. Personen je
/// Block in Einfügefolge: erst Stamm-Personal, dann Ad-hoc-Kräfte, dann Helfer, je Art in der
/// Reihenfolge der Eingabe.
#[tokio::test]
async fn reihenfolge_der_bloecke_und_personen_im_einsatz() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let bravo = einheit_bilden(&app, &admin, e, "Bravo").await;
    let alpha = einheit_bilden(&app, &admin, e, "Alpha").await;
    let charlie = einheit_bilden(&app, &admin, e, "Charlie").await;
    for (id, sortier) in [(alpha, 1), (bravo, 0), (charlie, 0)] {
        sqlx::query("UPDATE einsatz_einheit SET sortier = ? WHERE id = ?")
            .bind(sortier)
            .bind(id)
            .execute(&pool)
            .await
            .unwrap();
    }
    let zelt = uhs_anlegen(&app, &admin, e, "Zelt").await;
    let markt = uhs_anlegen(&app, &admin, e, "Markt").await;

    let einheit = |id: i64| json!({"art": "einheit", "einheit_id": id});
    let uhs = |id: i64| json!({"art": "uhs", "uhs_id": id});
    let mut plan = Value::Null;
    for (posten, stunde) in [
        (json!({"art": "pause"}), 9),
        (uhs(zelt), 10),
        (einheit(alpha), 10),
        (einheit(charlie), 12),
        (einheit(charlie), 10),
        (uhs(markt), 12),
        (einheit(bravo), 10),
        (json!({"art": "pause"}), 8),
    ] {
        let (s, p) = block(
            &app,
            &admin,
            e,
            json!({"posten": posten,
                   "von": format!("2026-11-06 {stunde:02}:00:00"),
                   "bis": format!("2026-11-06 {:02}:00:00", stunde + 1)}),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{p}");
        plan = p;
    }
    let erwartet: Vec<(String, String, String)> = [
        ("einheit", "Bravo", "10:00"),
        ("einheit", "Charlie", "10:00"),
        ("einheit", "Charlie", "12:00"),
        ("einheit", "Alpha", "10:00"),
        ("uhs", "Markt", "12:00"),
        ("uhs", "Zelt", "10:00"),
        ("pause", "", "08:00"),
        ("pause", "", "09:00"),
    ]
    .iter()
    .map(|(a, b, c)| (a.to_string(), b.to_string(), c.to_string()))
    .collect();
    assert_eq!(reihe(&plan), erwartet, "{plan}");
    let (_, gelesen) = anfrage(&app, "GET", &pfad(e), &admin, None).await;
    assert_eq!(
        reihe(&gelesen),
        erwartet,
        "GET wie die Antwort des Schreibwegs"
    );

    // Personen: Eingabe gemischt, Ausgabe nach Art gruppiert in Eingabefolge.
    let ben = stammpersonal_anlegen(&app, &admin, "Ben").await;
    let ada = stammpersonal_anlegen(&app, &admin, "Ada").await;
    let (s, kraft) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/personal"),
        &admin,
        Some(&json!({"adhoc": {"name": "Zora", "funktion": "Notarzt",
                               "staerke_position": "fuehrer"}})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{kraft}");
    let zora = kraft["id"].as_i64().unwrap();
    let (s, h) = anfrage_json(
        &app,
        "POST",
        &format!("{}/helfer", pfad(e)),
        &admin,
        Some(&json!({"name": "Cem"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{h}");
    let cem = h["id"].as_i64().unwrap();
    let personen_von = |plan: &Value| -> Vec<(String, i64)> {
        finde(plan, "pause", "2026-11-06 15:00:00")["personen"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| {
                let art = p["art"].as_str().unwrap().to_string();
                let schluessel = match art.as_str() {
                    "stamm" => "personal_id",
                    "einsatz" => "einsatz_personal_id",
                    _ => "helfer_id",
                };
                (art, p[schluessel].as_i64().unwrap())
            })
            .collect()
    };
    let (s, plan) = block(
        &app,
        &admin,
        e,
        json!({"posten": {"art": "pause"}, "von": "2026-11-06 15:00:00",
               "bis": "2026-11-06 16:00:00",
               "personen": [{"art": "helfer", "helfer_id": cem},
                            {"art": "stamm", "personal_id": ben},
                            {"art": "einsatz", "einsatz_personal_id": zora},
                            {"art": "stamm", "personal_id": ada}]}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{plan}");
    let paar = |a: &str, id: i64| (a.to_string(), id);
    assert_eq!(
        personen_von(&plan),
        vec![
            paar("stamm", ben),
            paar("stamm", ada),
            paar("einsatz", zora),
            paar("helfer", cem)
        ]
    );
    let bid = finde(&plan, "pause", "2026-11-06 15:00:00")["id"]
        .as_i64()
        .unwrap();
    let (s, plan) = anfrage_json(
        &app,
        "PATCH",
        &format!("{}/bloecke/{bid}", pfad(e)),
        &admin,
        Some(&json!({"version": 1,
                     "personen": [{"art": "einsatz", "einsatz_personal_id": zora},
                                  {"art": "helfer", "helfer_id": cem},
                                  {"art": "stamm", "personal_id": ada},
                                  {"art": "stamm", "personal_id": ben}]})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{plan}");
    assert_eq!(
        personen_von(&plan),
        vec![
            paar("stamm", ada),
            paar("stamm", ben),
            paar("einsatz", zora),
            paar("helfer", cem)
        ]
    );
}

/// Höchstzahlen je Einsatz, mit Seed-SQL statt Schleife: 2000 Schichten (Anlegen und Erzeugen)
/// und 500 Helfer.
#[tokio::test]
async fn hoechstzahlen_je_einsatz() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let markt = uhs_anlegen(&app, &admin, e, "UHS Markt").await;
    sqlx::query(
        "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 1999) \
         INSERT INTO einsatz_planschicht (einsatz_id, posten_art, von, bis) \
         SELECT ?, 'pause', '2026-11-06 10:00:00', '2026-11-06 11:00:00' FROM n",
    )
    .bind(e)
    .execute(&pool)
    .await
    .unwrap();
    let schichten = "Höchstens 2000 Schichten je Einsatz";
    // 1999 da: zwei erzeugte wären 2001.
    erwarte(
        anfrage_json(
            &app,
            "POST",
            &format!("{}/erzeugen", pfad(e)),
            &admin,
            Some(&json!({"posten": {"art": "uhs", "uhs_id": markt},
                         "von": "2026-11-06 14:00:00", "bis": "2026-11-06 16:00:00",
                         "laenge_minuten": 60})),
        )
        .await,
        StatusCode::UNPROCESSABLE_ENTITY,
        schichten,
    );
    let pause = json!({"posten": {"art": "pause"},
                       "von": "2026-11-06 12:00:00", "bis": "2026-11-06 13:00:00"});
    let (s, json) = block(&app, &admin, e, pause.clone()).await;
    assert_eq!(s, StatusCode::CREATED, "die 2000. Schicht geht: {json}");
    erwarte(
        block(&app, &admin, e, pause).await,
        StatusCode::UNPROCESSABLE_ENTITY,
        schichten,
    );

    sqlx::query(
        "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 500) \
         INSERT INTO einsatz_plan_helfer (einsatz_id, name) SELECT ?, 'Helfer ' || i FROM n",
    )
    .bind(e)
    .execute(&pool)
    .await
    .unwrap();
    erwarte(
        anfrage_json(
            &app,
            "POST",
            &format!("{}/helfer", pfad(e)),
            &admin,
            Some(&json!({"name": "Einer zu viel"})),
        )
        .await,
        StatusCode::UNPROCESSABLE_ENTITY,
        "Höchstens 500 Helfer je Einsatz",
    );
}
