//! Einsatz-Vorlagen (LLH-1375, Spec `einsatz-vorlagen`): Pflege je Organisation, Startliste,
//! Stichwort-Kopplung und Wirkung beim Anlegen eines Einsatzes.

use axum::http::StatusCode;
use serde_json::Value;

mod common;
use common::{anfrage, benutzer_anlegen, fremde_org_anlegen, login_cookie, setup_mit_pool};

const PFAD: &str = "/api/einsatz-vorlagen";

/// Die Vorlagen der eigenen Organisation als (Status, Liste).
async fn vorlagen(app: &axum::Router, cookie: &str) -> (StatusCode, Vec<Value>) {
    let (status, json) = anfrage(app, "GET", PFAD, cookie, None).await;
    (status, json.as_array().cloned().unwrap_or_default())
}

/// id der Vorlage mit dieser Bezeichnung in der eigenen Organisation.
async fn vorlage_id(app: &axum::Router, cookie: &str, bezeichnung: &str) -> i64 {
    let (_, liste) = vorlagen(app, cookie).await;
    liste
        .iter()
        .find(|v| v["bezeichnung"] == bezeichnung)
        .unwrap_or_else(|| panic!("Vorlage {bezeichnung} fehlt: {liste:?}"))["id"]
        .as_i64()
        .unwrap()
}

fn texte(liste: &Value) -> Vec<String> {
    liste
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap().to_string())
        .collect()
}

async fn einsatz_mit_vorlage(
    app: &axum::Router,
    cookie: &str,
    vorlage: Option<i64>,
) -> (StatusCode, Value) {
    let body = match vorlage {
        Some(id) => format!(r#"{{"bezeichnung":"Lage","vorlage_id":{id}}}"#),
        None => r#"{"bezeichnung":"Lage"}"#.to_string(),
    };
    anfrage(app, "POST", "/api/einsaetze", cookie, Some(&body)).await
}

async fn einsatz_anzahl(pool: &sqlx::SqlitePool) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM einsatz")
        .fetch_one(pool)
        .await
        .unwrap()
}

/// Legt eine Vorlage direkt in einer anderen Organisation an; liefert ihre id.
async fn fremde_vorlage(pool: &sqlx::SqlitePool, org_id: i64) -> i64 {
    sqlx::query_scalar(
        "INSERT INTO einsatz_vorlage (org_id, bezeichnung) VALUES (?, 'Fremd') RETURNING id",
    )
    .bind(org_id)
    .fetch_one(pool)
    .await
    .unwrap()
}

// ----------------------------- Startliste -----------------------------

#[tokio::test]
async fn neue_organisation_hat_die_startliste() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (status, liste) = vorlagen(&app, &admin).await;
    assert_eq!(status, StatusCode::OK);
    let namen: Vec<&str> = liste
        .iter()
        .map(|v| v["bezeichnung"].as_str().unwrap())
        .collect();
    assert_eq!(
        namen,
        [
            "Kleinlage",
            "Sanitätsdienst",
            "MANV",
            "Personensuche",
            "Evakuierung und Betreuung",
            "Unwetter"
        ]
    );
    let manv = &liste[2];
    let aus = texte(&manv["ausgeblendet"]);
    assert!(aus.contains(&"stab".to_string()) && aus.contains(&"tiere".to_string()));
    assert_eq!(manv["einsatzart"], "realeinsatz");
    assert_eq!(liste[1]["einsatzart"], "sanitaetsdienst");
}

// ----------------------------- Pflege -----------------------------

#[tokio::test]
async fn admin_legt_vorlage_an_und_jeder_der_org_liest_sie() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "erika", "keine").await;

    let (status, json) = anfrage(
        &app,
        "POST",
        PFAD,
        &admin,
        Some(r#"{"bezeichnung":"  Großbrand ","ausgeblendet":["tiere"]}"#),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{json:?}");
    assert_eq!(json["bezeichnung"], "Großbrand");
    assert_eq!(texte(&json["ausgeblendet"]), ["tiere"]);
    assert!(
        !json.as_object().unwrap().contains_key("einsatzart"),
        "ohne Einsatzart fehlt das Feld: {json:?}"
    );
    assert_eq!(json["sortier"], 70, "ans Ende der Startliste");

    let erika = login_cookie(&app, "erika", "erikapw1").await;
    let (status, liste) = vorlagen(&app, &erika).await;
    assert_eq!(status, StatusCode::OK);
    let grossbrand = liste
        .iter()
        .find(|v| v["bezeichnung"] == "Großbrand")
        .expect("Großbrand im nächsten Abruf");
    assert_eq!(texte(&grossbrand["ausgeblendet"]), ["tiere"]);
}

#[tokio::test]
async fn feldfehler_sind_400_und_speichern_nichts() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, vorher) = vorlagen(&app, &admin).await;

    for body in [
        r#"{"bezeichnung":"A","ausgeblendet":["einsatzdaten"]}"#,
        r#"{"bezeichnung":"A","ausgeblendet":["einsatz-einstellungen"]}"#,
        r#"{"bezeichnung":"A","ausgeblendet":["gibtsnicht"]}"#,
        r#"{"bezeichnung":"A","einsatzart":"grossbrand","ausgeblendet":[]}"#,
        r#"{"bezeichnung":"   ","ausgeblendet":[]}"#,
        r#"{"bezeichnung":"A"}"#,
        r#"{"ausgeblendet":[]}"#,
    ] {
        let (status, json) = anfrage(&app, "POST", PFAD, &admin, Some(body)).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}: {json:?}");
    }
    let (_, nachher) = vorlagen(&app, &admin).await;
    assert_eq!(vorher, nachher, "nichts gespeichert");

    // Auch der Vollersatz prüft und lässt die Vorlage bei einem Fehler unverändert.
    let manv = vorlage_id(&app, &admin, "MANV").await;
    let (status, _) = anfrage(
        &app,
        "PUT",
        &format!("{PFAD}/{manv}"),
        &admin,
        Some(r#"{"bezeichnung":"MANV","ausgeblendet":["einsatzdaten"]}"#),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (_, nachher) = vorlagen(&app, &admin).await;
    assert_eq!(vorher, nachher);
}

#[tokio::test]
async fn doppelte_bezeichnung_ist_409() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (status, _) = anfrage(
        &app,
        "POST",
        PFAD,
        &admin,
        Some(r#"{"bezeichnung":"MANV","ausgeblendet":[]}"#),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);

    let kleinlage = vorlage_id(&app, &admin, "Kleinlage").await;
    let (status, _) = anfrage(
        &app,
        "PUT",
        &format!("{PFAD}/{kleinlage}"),
        &admin,
        Some(r#"{"bezeichnung":"MANV","ausgeblendet":[]}"#),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
}

#[tokio::test]
async fn vollersatz_und_loeschen() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let kleinlage = vorlage_id(&app, &admin, "Kleinlage").await;

    let (status, json) = anfrage(
        &app,
        "PUT",
        &format!("{PFAD}/{kleinlage}"),
        &admin,
        Some(
            r#"{"bezeichnung":"Kleine Lage","einsatzart":"uebung","ausgeblendet":["chat","stab"]}"#,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(json["bezeichnung"], "Kleine Lage");
    assert_eq!(json["einsatzart"], "uebung");
    assert_eq!(texte(&json["ausgeblendet"]), ["stab", "chat"]);
    assert_eq!(json["sortier"], 10, "sortier bleibt");

    let (status, _) = anfrage(&app, "DELETE", &format!("{PFAD}/{kleinlage}"), &admin, None).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, _) = anfrage(&app, "DELETE", &format!("{PFAD}/{kleinlage}"), &admin, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (_, liste) = vorlagen(&app, &admin).await;
    assert_eq!(liste.len(), 5);
}

#[tokio::test]
async fn ohne_admin_rechte_nur_lesen() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "fuehrung", "fuehrungskraft").await;
    let fk = login_cookie(&app, "fuehrung", "fuehrungpw1").await;
    let manv = vorlage_id(&app, &admin, "MANV").await;

    let (status, _) = vorlagen(&app, &fk).await;
    assert_eq!(status, StatusCode::OK);
    for (methode, pfad, body) in [
        ("POST", PFAD.to_string(), Some(r#"{"bezeichnung":"X"}"#)),
        (
            "PUT",
            format!("{PFAD}/{manv}"),
            Some(r#"{"bezeichnung":"X"}"#),
        ),
        ("DELETE", format!("{PFAD}/{manv}"), None),
        (
            "PUT",
            "/api/stichwort-vorschlaege/1/vorlage".to_string(),
            Some(r#"{"vorlage_id":null}"#),
        ),
    ] {
        let (status, _) = anfrage(&app, methode, &pfad, &fk, body).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{methode} {pfad}");
    }
}

#[tokio::test]
async fn vorlagen_anderer_organisationen_sind_unsichtbar() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (fremd_org, _) = fremde_org_anlegen(&pool, "Fremd-Org", "fremd", "fremdpw1", "keine").await;
    let fremd = fremde_vorlage(&pool, fremd_org).await;

    let (_, liste) = vorlagen(&app, &admin).await;
    assert!(liste.iter().all(|v| v["id"] != fremd));
    let (status, _) = anfrage(
        &app,
        "PUT",
        &format!("{PFAD}/{fremd}"),
        &admin,
        Some(r#"{"bezeichnung":"Übernommen","ausgeblendet":[]}"#),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = anfrage(&app, "DELETE", &format!("{PFAD}/{fremd}"), &admin, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let bezeichnung: String =
        sqlx::query_scalar("SELECT bezeichnung FROM einsatz_vorlage WHERE id = ?")
            .bind(fremd)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(bezeichnung, "Fremd");
}

// ----------------------------- Stichwort-Kopplung -----------------------------

/// id des Stichwort-Vorschlags mit diesem Text und seine Kopplung (fehlt = keine).
async fn stichwort(app: &axum::Router, cookie: &str, text: &str) -> (i64, Option<i64>) {
    let (status, json) = anfrage(app, "GET", "/api/stichwort-vorschlaege", cookie, None).await;
    assert_eq!(status, StatusCode::OK);
    let v = json
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["text"] == text)
        .unwrap_or_else(|| panic!("Stichwort {text} fehlt: {json:?}"))
        .clone();
    let obj = v.as_object().unwrap();
    (
        v["id"].as_i64().unwrap(),
        obj.get("vorlage_id").map(|w| w.as_i64().unwrap()),
    )
}

#[tokio::test]
async fn stichwort_koppeln_loesen_und_vorlage_loeschen() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let manv = vorlage_id(&app, &admin, "MANV").await;
    let (sw, kopplung) = stichwort(&app, &admin, "MANV15").await;
    assert_eq!(kopplung, None, "keine mitgelieferte Kopplung");

    let pfad = format!("/api/stichwort-vorschlaege/{sw}/vorlage");
    let (status, json) = anfrage(
        &app,
        "PUT",
        &pfad,
        &admin,
        Some(&format!(r#"{{"vorlage_id":{manv}}}"#)),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(json["vorlage_id"], manv);
    assert_eq!(stichwort(&app, &admin, "MANV15").await.1, Some(manv));

    // Fremde oder unbekannte Vorlage 400, fehlendes Feld 400, unbekannter Vorschlag 404.
    let (fremd_org, _) = fremde_org_anlegen(&pool, "Fremd-Org", "fremd", "fremdpw1", "keine").await;
    let fremd = fremde_vorlage(&pool, fremd_org).await;
    for body in [
        format!(r#"{{"vorlage_id":{fremd}}}"#),
        r#"{"vorlage_id":999999}"#.to_string(),
        "{}".to_string(),
    ] {
        let (status, _) = anfrage(&app, "PUT", &pfad, &admin, Some(&body)).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    }
    assert_eq!(stichwort(&app, &admin, "MANV15").await.1, Some(manv));
    let (status, _) = anfrage(
        &app,
        "PUT",
        "/api/stichwort-vorschlaege/999999/vorlage",
        &admin,
        Some(r#"{"vorlage_id":null}"#),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // `null` löst die Kopplung.
    let (status, _) = anfrage(&app, "PUT", &pfad, &admin, Some(r#"{"vorlage_id":null}"#)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(stichwort(&app, &admin, "MANV15").await.1, None);

    // Löschen der gekoppelten Vorlage lässt den Vorschlag ohne Vorlage stehen.
    let (status, _) = anfrage(
        &app,
        "PUT",
        &pfad,
        &admin,
        Some(&format!(r#"{{"vorlage_id":{manv}}}"#)),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = anfrage(&app, "DELETE", &format!("{PFAD}/{manv}"), &admin, None).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(stichwort(&app, &admin, "MANV15").await, (sw, None));
}

// ----------------------------- Wirkung beim Anlegen -----------------------------

#[tokio::test]
async fn manv_blendet_beim_anlegen_aus_und_schreibt_eigene_werte() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let fk_id = benutzer_anlegen(&app, &admin, "fuehrung", "fuehrungskraft").await;
    let fk = login_cookie(&app, "fuehrung", "fuehrungpw1").await;
    let manv = vorlage_id(&app, &fk, "MANV").await;

    let (status, json) = einsatz_mit_vorlage(&app, &fk, Some(manv)).await;
    assert_eq!(status, StatusCode::CREATED, "{json:?}");
    let eid = json["id"].as_i64().unwrap();

    let (status, overrides) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{eid}/modul-overrides"),
        &fk,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let map = overrides.as_object().unwrap();
    let stab = &map["stab"];
    assert_eq!(stab["sichtbar"], false);
    assert_eq!(stab["benoetigte_rolle"], Value::Null);
    assert_eq!(stab["geaendert_von"], fk_id);
    assert!(
        !map.contains_key("unfallhilfsstellen"),
        "sichtbare Module bekommen keine Zeile"
    );
    let mut keys: Vec<&str> = map.keys().map(String::as_str).collect();
    keys.sort_unstable();
    assert_eq!(
        keys,
        [
            "betreuung",
            "evakuierung",
            "schaeden",
            "stab",
            "tiere",
            "verpflegung",
            "wetter-pegel"
        ]
    );

    let (_, freigaben) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{eid}/modul-freigaben"),
        &fk,
        None,
    )
    .await;
    assert_eq!(freigaben["stab"]["sichtbar"], false);
    assert_eq!(freigaben["unfallhilfsstellen"]["sichtbar"], true);
}

#[tokio::test]
async fn org_ausblendung_bleibt_neben_der_vorlage() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (status, _) = anfrage(
        &app,
        "PUT",
        "/api/org-modul-einstellungen/fernmeldewesen",
        &admin,
        Some(r#"{"benoetigte_rolle":null,"sichtbar":false}"#),
    )
    .await;
    assert!(status.is_success(), "{status}");
    let manv = vorlage_id(&app, &admin, "MANV").await;

    let (status, json) = einsatz_mit_vorlage(&app, &admin, Some(manv)).await;
    assert_eq!(status, StatusCode::CREATED, "{json:?}");
    let eid = json["id"].as_i64().unwrap();
    let (_, freigaben) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{eid}/modul-freigaben"),
        &admin,
        None,
    )
    .await;
    assert_eq!(freigaben["fernmeldewesen"]["sichtbar"], false);
    let (_, overrides) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{eid}/modul-overrides"),
        &admin,
        None,
    )
    .await;
    assert!(
        !overrides
            .as_object()
            .unwrap()
            .contains_key("fernmeldewesen"),
        "die Vorlage blendet nie ein: {overrides:?}"
    );
}

#[tokio::test]
async fn ohne_vorlage_keine_modulwerte() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    for body in [
        r#"{"bezeichnung":"Lage"}"#,
        r#"{"bezeichnung":"Lage","vorlage_id":null}"#,
    ] {
        let (status, json) = anfrage(&app, "POST", "/api/einsaetze", &admin, Some(body)).await;
        assert_eq!(status, StatusCode::CREATED, "{json:?}");
        let eid = json["id"].as_i64().unwrap();
        let (_, overrides) = anfrage(
            &app,
            "GET",
            &format!("/api/einsaetze/{eid}/modul-overrides"),
            &admin,
            None,
        )
        .await;
        assert_eq!(overrides, serde_json::json!({}), "{body}");
    }
}

#[tokio::test]
async fn fremde_oder_unbekannte_vorlage_ist_400_ohne_einsatz() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (fremd_org, _) = fremde_org_anlegen(&pool, "Fremd-Org", "fremd", "fremdpw1", "keine").await;
    let fremd = fremde_vorlage(&pool, fremd_org).await;
    let vorher = einsatz_anzahl(&pool).await;

    for vorlage in [fremd, 999_999] {
        let (status, json) = einsatz_mit_vorlage(&app, &admin, Some(vorlage)).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{vorlage}: {json:?}");
    }
    assert_eq!(
        einsatz_anzahl(&pool).await,
        vorher,
        "kein Einsatz entstanden"
    );
    let overrides: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_modul_override")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(overrides, 0);
}

#[tokio::test]
async fn spaetere_aenderung_der_vorlage_wirkt_nur_auf_neue_einsaetze() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let manv = vorlage_id(&app, &admin, "MANV").await;
    let (_, json) = einsatz_mit_vorlage(&app, &admin, Some(manv)).await;
    let alt = json["id"].as_i64().unwrap();

    let (status, _) = anfrage(
        &app,
        "PUT",
        &format!("{PFAD}/{manv}"),
        &admin,
        Some(r#"{"bezeichnung":"MANV","ausgeblendet":["chat"]}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (_, json) = einsatz_mit_vorlage(&app, &admin, Some(manv)).await;
    let neu = json["id"].as_i64().unwrap();

    let keys = |v: Value| {
        let mut k: Vec<String> = v.as_object().unwrap().keys().cloned().collect();
        k.sort();
        k
    };
    let (_, a) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{alt}/modul-overrides"),
        &admin,
        None,
    )
    .await;
    let (_, n) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{neu}/modul-overrides"),
        &admin,
        None,
    )
    .await;
    assert!(keys(a).contains(&"stab".to_string()));
    assert_eq!(keys(n), ["chat"]);
}
