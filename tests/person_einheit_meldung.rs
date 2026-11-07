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

    let (s, p) = person_post(
        &app,
        &admin,
        e,
        json!({ "versorgende_einheit_id": streife }),
    )
    .await;
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

    let (s, v) = person_patch(
        &app,
        &admin,
        e,
        pid,
        json!({ "versorgende_einheit_id": null }),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert!(!v
        .as_object()
        .unwrap()
        .contains_key("versorgende_einheit_id"));

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

/// Feld-CAS der Einheit zusammen mit dem gleichtypigen Nachbarn `kontamination` (beide als
/// Ganzzahl gebunden): jede Bedingung liest ihren eigenen Altwert, ein vertauschter Bind fiele
/// hier auf.
#[tokio::test]
async fn einheit_und_kontamination_vergleichen_je_ihren_altwert() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    // Zwei Einheiten vorweg, damit keine die Id 1 trägt (= `kontamination: true`).
    einheit_bilden(&app, &admin, e, "Vorweg").await;
    let streife = einheit_bilden(&app, &admin, e, "Streife 1").await;
    let rtw = einheit_bilden(&app, &admin, e, "RTW 1").await;
    assert!(streife != 1 && rtw != 1);
    let (_, p) = person_post(&app, &admin, e, json!({})).await;
    let pid = p["id"].as_i64().unwrap();
    let (s, v) = person_patch(
        &app,
        &admin,
        e,
        pid,
        json!({ "versorgende_einheit_id": streife, "kontamination": true }),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");

    for (erwartet, fall) in [
        (
            json!({ "versorgende_einheit_id": rtw, "kontamination": true }),
            "Einheit",
        ),
        (
            json!({ "versorgende_einheit_id": streife, "kontamination": false }),
            "Kontamination",
        ),
    ] {
        let (s, v) = person_patch(
            &app,
            &admin,
            e,
            pid,
            json!({ "versorgende_einheit_id": rtw, "kontamination": false, "erwartet": erwartet }),
        )
        .await;
        assert_eq!(s, StatusCode::CONFLICT, "{fall}: {v}");
    }
    let (s, v) = person_patch(
        &app,
        &admin,
        e,
        pid,
        json!({
            "versorgende_einheit_id": rtw,
            "kontamination": false,
            "erwartet": { "versorgende_einheit_id": streife, "kontamination": true },
        }),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["versorgende_einheit_id"], rtw);
    assert_eq!(v["kontamination"], false);
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
    let (s, _) = person_post(
        &app,
        &admin,
        e,
        json!({ "versorgende_einheit_id": 999_999 }),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);

    // Aufgelöst mit Spur (versorgter Patient): die Einheit bleibt stehen, neue Bezüge sind 422.
    let streife = einheit_bilden(&app, &admin, e, "Streife 3").await;
    let (s, p) = person_post(
        &app,
        &admin,
        e,
        json!({ "versorgende_einheit_id": streife }),
    )
    .await;
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
    let (s, _) = person_post(
        &app,
        &admin,
        e,
        json!({ "versorgende_einheit_id": streife }),
    )
    .await;
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
    person_post(
        &app,
        &admin,
        e,
        json!({ "versorgende_einheit_id": streife }),
    )
    .await;
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
    assert!(
        !m.as_object().unwrap().contains_key("patienten"),
        "ohne Patienten fehlt der Schlüssel: {m}"
    );

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

/// Koppelt ein UHS-Gerät (`ansicht`) an eine neue, aktive UHS; liefert das Geräte-Cookie.
async fn uhs_geraet(app: &axum::Router, admin: &str, e: i64, ansicht: &str) -> String {
    let (s, v) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{e}/uhs"),
        admin,
        Some(&json!({"typ": "behandlungsplatz", "bezeichnung": "UHS Nord"}).to_string()),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let uhs = v["id"].as_i64().unwrap();
    let (s, v) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{e}/uhs/{uhs}/status"),
        admin,
        Some(&json!({"status": "aktiv"}).to_string()),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let (s, v) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{e}/geraete"),
        admin,
        Some(&json!({"ansicht": ansicht, "uhs_id": uhs, "bezeichnung": "Gerät 1"}).to_string()),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let code = v["code"]["code"].as_str().unwrap().to_string();
    let resp = tower::ServiceExt::oneshot(
        app.clone(),
        axum::http::Request::builder()
            .method("POST")
            .uri("/api/geraete/koppeln")
            .header(axum::http::header::CONTENT_TYPE, "application/json")
            .body(axum::body::Body::from(json!({ "code": code }).to_string()))
            .unwrap(),
    )
    .await
    .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    resp.headers()[axum::http::header::SET_COOKIE]
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_string()
}

/// Ein Gerät liest nur die eigenen Meldungen und verknüpft daher auch nur an diese; eine fremde
/// antwortet wie eine unbekannte (422).
#[tokio::test]
async fn geraet_verknuepft_nur_eigene_meldungen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let laptop = uhs_geraet(&app, &admin, e, "uhs-laptop").await;
    let fremd = meldung_anlegen(&app, &admin, e, json!({})).await;
    let eigen = meldung_anlegen(&app, &laptop, e, json!({})).await;

    let (s, v) = person_post(&app, &laptop, e, json!({ "meldung_id": fremd["id"] })).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    let (s, v) = person_post(&app, &laptop, e, json!({ "meldung_id": eigen["id"] })).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(v["meldung_id"], eigen["id"]);
    // Die Leitung verknüpft weiter an jede Meldung des Einsatzes.
    let (s, v) = person_post(&app, &admin, e, json!({ "meldung_id": eigen["id"] })).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
}

/// Das UHS-Tablet liest keine Meldungen: auch eine ihm zugeschriebene verknüpft es nicht (422).
#[tokio::test]
async fn tablet_ohne_meldungen_verknuepft_keine() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let tablet = uhs_geraet(&app, &admin, e, "uhs-tablet").await;
    let (s, ich) = anfrage(&app, "GET", "/api/auth/me", &tablet, None).await;
    assert_eq!(s, StatusCode::OK, "{ich}");
    let m = meldung_anlegen(&app, &admin, e, json!({})).await;
    // Über die API erfasst das Tablet keine Meldung; die Zuschreibung von Hand prüft, dass nicht
    // erst die Eigentümerprüfung greift.
    sqlx::query("UPDATE meldung SET erfasst_von_id = ? WHERE id = ?")
        .bind(ich["id"].as_i64().unwrap())
        .bind(m["id"].as_i64().unwrap())
        .execute(&pool)
        .await
        .unwrap();
    let (s, v) = person_post(&app, &tablet, e, json!({ "meldung_id": m["id"] })).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    let (s, v) = person_post(&app, &tablet, e, json!({})).await;
    assert_eq!(
        s,
        StatusCode::CREATED,
        "ohne Meldung legt das Tablet an: {v}"
    );
}
