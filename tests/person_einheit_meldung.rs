//! Versorgende Einheit am Patienten und Patient aus einer Meldung (LLH-1567, Change
//! `unxqhab4-patient-einheit-meldung`, design.md D1–D6).

use axum::http::StatusCode;
use serde_json::{json, Value};

mod common;
use common::{anfrage, einheit_bilden, einsatz_anlegen, login_cookie, setup, setup_mit_pool};

async fn person_post(app: &axum::Router, cookie: &str, e: i64, body: Value) -> (StatusCode, Value) {
    anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{e}/personen"),
        cookie,
        Some(&body.to_string()),
    )
    .await
}

async fn person_patch(
    app: &axum::Router,
    cookie: &str,
    e: i64,
    p: i64,
    body: Value,
) -> (StatusCode, Value) {
    anfrage(
        app,
        "PATCH",
        &format!("/api/einsaetze/{e}/personen/{p}"),
        cookie,
        Some(&body.to_string()),
    )
    .await
}

async fn abschnitt_anlegen(app: &axum::Router, cookie: &str, e: i64, name: &str) -> i64 {
    let (s, v) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{e}/abschnitte"),
        cookie,
        Some(&json!({ "name": name }).to_string()),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    v["id"].as_i64().unwrap()
}

async fn meldung_anlegen(app: &axum::Router, cookie: &str, e: i64, extra: Value) -> Value {
    let mut body = json!({
        "absender": "Ordner Bühne 2",
        "meldeweg": "funk",
        "inhalt": "Person kollabiert vor Bühne 2",
        "ereigniszeit": "2026-06-12 20:15:00"
    });
    body.as_object_mut()
        .unwrap()
        .extend(extra.as_object().unwrap().clone());
    let (s, v) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{e}/meldungen"),
        cookie,
        Some(&body.to_string()),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    v
}

async fn meldungen(app: &axum::Router, cookie: &str, e: i64) -> Vec<Value> {
    let (s, v) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{e}/meldungen"),
        cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    v.as_array().unwrap().clone()
}

#[tokio::test]
async fn einheit_beim_anlegen_mit_name_und_abschnitt_aus_der_einheit() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let abschnitt = abschnitt_anlegen(&app, &admin, e, "Bühne").await;
    let streife = einheit_bilden(&app, &admin, e, "Streife 2").await;
    let (s, v) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{e}/einheiten/{streife}"),
        &admin,
        Some(&json!({ "abschnitt_id": abschnitt }).to_string()),
    )
    .await;
    assert!(s.is_success(), "Abschnitt setzen: {s} {v}");

    let (s, p) = person_post(&app, &admin, e, json!({ "versorgende_einheit_id": streife })).await;
    assert_eq!(s, StatusCode::CREATED, "{p}");
    assert_eq!(p["versorgende_einheit_id"], streife);
    assert_eq!(p["versorgende_einheit_name"], "Streife 2");
    assert_eq!(p["versorgende_einheit_abschnitt_id"], abschnitt);
    assert_eq!(p["versorgende_einheit_abschnitt_name"], "Bühne");

    // Ohne Bezug fehlen die Schlüssel (skip_serializing_if), statt `null` zu tragen.
    let (_, ohne) = person_post(&app, &admin, e, json!({})).await;
    let o = ohne.as_object().unwrap();
    for k in [
        "versorgende_einheit_id",
        "versorgende_einheit_name",
        "meldung_id",
        "meldung_lfd_nr",
    ] {
        assert!(!o.contains_key(k), "{k}: {ohne}");
    }
}

#[tokio::test]
async fn einheit_aendern_leeren_und_feld_cas() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let streife = einheit_bilden(&app, &admin, e, "Streife 1").await;
    let rtw = einheit_bilden(&app, &admin, e, "RTW 1").await;
    let (_, p) = person_post(&app, &admin, e, json!({})).await;
    let pid = p["id"].as_i64().unwrap();

    let (s, v) = person_patch(
        &app,
        &admin,
        e,
        pid,
        json!({ "versorgende_einheit_id": streife, "erwartet": { "versorgende_einheit_id": null } }),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["versorgende_einheit_name"], "Streife 1");

    // Veralteter Altwert: 409, der Stand bleibt.
    let (s, v) = person_patch(
        &app,
        &admin,
        e,
        pid,
        json!({ "versorgende_einheit_id": rtw, "erwartet": { "versorgende_einheit_id": null } }),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "{v}");

    let (s, v) = person_patch(
        &app,
        &admin,
        e,
        pid,
        json!({ "versorgende_einheit_id": rtw, "erwartet": { "versorgende_einheit_id": streife } }),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["versorgende_einheit_id"], rtw);

    // Ein anderes Feld lässt die Einheit stehen.
    let (s, v) = person_patch(&app, &admin, e, pid, json!({ "notiz": "x" })).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["versorgende_einheit_id"], rtw);

    let (s, v) = person_patch(&app, &admin, e, pid, json!({ "versorgende_einheit_id": null })).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert!(!v.as_object().unwrap().contains_key("versorgende_einheit_id"));

    // Altwert ohne Änderung desselben Felds: 422.
    let (s, _) = person_patch(
        &app,
        &admin,
        e,
        pid,
        json!({ "notiz": "y", "erwartet": { "versorgende_einheit_id": null } }),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn fremde_und_aufgeloeste_einheit_sind_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let anderer = einsatz_anlegen(&app, &admin).await;
    let fremd = einheit_bilden(&app, &admin, anderer, "Fremde Streife").await;
    let (s, _) = person_post(&app, &admin, e, json!({ "versorgende_einheit_id": fremd })).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
    let (s, _) = person_post(&app, &admin, e, json!({ "versorgende_einheit_id": 999_999 })).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);

    // Aufgelöst mit Spur (versorgter Patient): die Einheit bleibt stehen, neue Bezüge sind 422.
    let streife = einheit_bilden(&app, &admin, e, "Streife 3").await;
    let (s, p) = person_post(&app, &admin, e, json!({ "versorgende_einheit_id": streife })).await;
    assert_eq!(s, StatusCode::CREATED, "{p}");
    let (s, v) = anfrage(
        &app,
        "DELETE",
        &format!("/api/einsaetze/{e}/einheiten/{streife}"),
        &admin,
        None,
    )
    .await;
    assert!(s.is_success(), "auflösen: {s} {v}");
    let (s, _) = person_post(&app, &admin, e, json!({ "versorgende_einheit_id": streife })).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
    let (s, _) = person_patch(
        &app,
        &admin,
        e,
        p["id"].as_i64().unwrap(),
        json!({ "versorgende_einheit_id": streife }),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);

    // Der versorgte Patient nennt die aufgelöste Einheit weiter beim Namen (Bericht).
    let (_, detail) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/personen/{}", p["id"]),
        &admin,
        None,
    )
    .await;
    let person = detail.get("person").unwrap_or(&detail);
    assert_eq!(person["versorgende_einheit_name"], "Streife 3");
}

#[tokio::test]
async fn versorgter_patient_ist_eine_spur_der_einheit() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let streife = einheit_bilden(&app, &admin, e, "Streife 4").await;
    person_post(&app, &admin, e, json!({ "versorgende_einheit_id": streife })).await;
    let (s, v) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/einheiten/{streife}/stornieren"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    assert!(
        v["error"].as_str().unwrap().contains("Patienten versorgt"),
        "{v}"
    );

    // Eine stornierte Person ist keine Spur: die Einheit wird gelöscht, der Verweis geleert.
    let leer = einheit_bilden(&app, &admin, e, "Streife 5").await;
    let (_, p) = person_post(&app, &admin, e, json!({ "versorgende_einheit_id": leer })).await;
    let pid = p["id"].as_i64().unwrap();
    let (s, _) = anfrage(
        &app,
        "DELETE",
        &format!("/api/einsaetze/{e}/personen/{pid}"),
        &admin,
        None,
    )
    .await;
    assert!(s.is_success());
    let (s, v) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/einheiten/{leer}/stornieren"),
        &admin,
        None,
    )
    .await;
    assert!(s.is_success(), "{s} {v}");
    let verweis: Option<i64> =
        sqlx::query_scalar("SELECT versorgende_einheit_id FROM einsatz_person WHERE id = ?")
            .bind(pid)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(verweis, None);
}

#[tokio::test]
async fn einheitenwahl_am_modul_personen_ohne_aufgeloeste() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let abschnitt = abschnitt_anlegen(&app, &admin, e, "Einlass").await;
    let a = einheit_bilden(&app, &admin, e, "Streife A").await;
    anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{e}/einheiten/{a}"),
        &admin,
        Some(&json!({ "abschnitt_id": abschnitt }).to_string()),
    )
    .await;
    let weg = einheit_bilden(&app, &admin, e, "Streife weg").await;
    anfrage(
        &app,
        "DELETE",
        &format!("/api/einsaetze/{e}/einheiten/{weg}"),
        &admin,
        None,
    )
    .await;

    let (s, v) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/personen/einheiten"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let zeilen = v.as_array().unwrap();
    assert_eq!(zeilen.len(), 1, "{v}");
    assert_eq!(zeilen[0]["id"], a);
    assert_eq!(zeilen[0]["name"], "Streife A");
    assert_eq!(zeilen[0]["abschnitt_name"], "Einlass");
}

#[tokio::test]
async fn patient_aus_meldung_in_beide_richtungen_sichtbar() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let m = meldung_anlegen(&app, &admin, e, json!({})).await;
    let mid = m["id"].as_i64().unwrap();
    assert_eq!(m["patienten"], json!([]), "noch ohne Patienten: {m}");

    let (s, p1) = person_post(&app, &admin, e, json!({ "meldung_id": mid })).await;
    assert_eq!(s, StatusCode::CREATED, "{p1}");
    assert_eq!(p1["meldung_id"], mid);
    assert_eq!(p1["meldung_lfd_nr"], m["lfd_nr"]);
    let (_, p2) = person_post(&app, &admin, e, json!({ "meldung_id": mid })).await;
    let (_, storniert) = person_post(&app, &admin, e, json!({ "meldung_id": mid })).await;
    let (s, _) = anfrage(
        &app,
        "DELETE",
        &format!("/api/einsaetze/{e}/personen/{}", storniert["id"]),
        &admin,
        None,
    )
    .await;
    assert!(s.is_success());

    let liste = meldungen(&app, &admin, e).await;
    let karte = liste.iter().find(|x| x["id"] == mid).unwrap();
    assert_eq!(
        karte["patienten"],
        json!([
            { "id": p1["id"], "registrier_nr": p1["registrier_nr"] },
            { "id": p2["id"], "registrier_nr": p2["registrier_nr"] },
        ]),
        "nach Registriernummer, ohne Stornierte"
    );
}

#[tokio::test]
async fn meldung_eines_anderen_einsatzes_ist_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let anderer = einsatz_anlegen(&app, &admin).await;
    let m = meldung_anlegen(&app, &admin, anderer, json!({})).await;
    let (s, _) = person_post(&app, &admin, e, json!({ "meldung_id": m["id"] })).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn meldung_traegt_ihre_verortung() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let m = meldung_anlegen(
        &app,
        &admin,
        e,
        json!({ "meldungsart": "lagemeldung", "lat": 52.27, "lon": 9.13 }),
    )
    .await;
    let liste = meldungen(&app, &admin, e).await;
    let karte = liste.iter().find(|x| x["id"] == m["id"]).unwrap();
    assert_eq!(karte["lat"], 52.27, "{karte}");
    assert_eq!(karte["lon"], 9.13, "{karte}");
}
