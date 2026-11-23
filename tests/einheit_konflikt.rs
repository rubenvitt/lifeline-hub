//! Feld-CAS und Änderungsvermerk an der Einheit (LLH-1831, LLH-1834; Change
//! `nvhnqynd-konflikt-und-aenderungsvermerk`, Specs `einheit-ansicht` „Angabe der Einheit mit
//! Altwert speichern“ / „Altwerte einer Einheit-Anfrage gemeinsam geprüft“ und
//! `aenderungsvermerk`).

use axum::http::StatusCode;
use serde_json::{json, Value};

mod common;
use common::*;

async fn patchen(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    eid: i64,
    body: Value,
) -> (StatusCode, Value) {
    anfrage_json(
        app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/units/{eid}"),
        cookie,
        Some(&body),
    )
    .await
}

async fn einheit(app: &axum::Router, cookie: &str, einsatz: i64, eid: i64) -> Value {
    let (s, liste) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/units"),
        cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{liste:?}");
    liste
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"] == eid)
        .cloned()
        .expect("Einheit in der Liste")
}

async fn start() -> (axum::Router, String, i64, i64) {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let eid = einheit_bilden(&app, &admin, einsatz, "Trupp 1").await;
    (app, admin, einsatz, eid)
}

async fn personal_zuordnen(app: &axum::Router, cookie: &str, einsatz: i64, eid: i64, ep: i64) {
    let (s, _) = anfrage(
        app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/units/{eid}/personnel/{ep}"),
        cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn bemerkung_mit_veraltetem_stand_ist_409() {
    let (app, admin, einsatz, eid) = start().await;
    patchen(&app, &admin, einsatz, eid, json!({"bemerkung": "Tor 3"})).await;
    patchen(&app, &admin, einsatz, eid, json!({"bemerkung": "Tor 5"})).await;
    let (s, j) = patchen(
        &app,
        &admin,
        einsatz,
        eid,
        json!({"bemerkung": "Halle 2", "erwartet": {"bemerkung": "Tor 3"}}),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "{j:?}");
    // Sperrkonflikt ausgezeichnet (src/AGENTS.md, Statuscode-Konvention, LLH-1920).
    assert_eq!(j["grund"], "veraltet", "{j:?}");
    assert_eq!(
        einheit(&app, &admin, einsatz, eid).await["bemerkung"],
        "Tor 5"
    );
}

#[tokio::test]
async fn andere_angabe_dazwischen_speichert() {
    let (app, admin, einsatz, eid) = start().await;
    // Die Ansicht öffnet die Bemerkung leer, ein anderer Arbeitsplatz setzt den Funkrufnamen.
    patchen(
        &app,
        &admin,
        einsatz,
        eid,
        json!({"funkrufname": "Florian 1"}),
    )
    .await;
    let (s, j) = patchen(
        &app,
        &admin,
        einsatz,
        eid,
        json!({"bemerkung": "Tor 3", "erwartet": {"bemerkung": null}}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{j:?}");
    let e = einheit(&app, &admin, einsatz, eid).await;
    assert_eq!(e["bemerkung"], "Tor 3");
    assert_eq!(e["funkrufname"], "Florian 1");
}

#[tokio::test]
async fn verbindungen_als_ganzes_verglichen() {
    let (app, admin, einsatz, eid) = start().await;
    let tel = json!({"mittel": "festnetz", "wert": "0911 123"});
    patchen(&app, &admin, einsatz, eid, json!({"verbindungen": [tel]})).await;
    let (s, j) = patchen(
        &app,
        &admin,
        einsatz,
        eid,
        json!({
            "verbindungen": [{"mittel": "mobil", "wert": "0170 1"}],
            "erwartet": {"verbindungen": []}
        }),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "{j:?}");
    let e = einheit(&app, &admin, einsatz, eid).await;
    assert_eq!(e["verbindungen"].as_array().unwrap().len(), 1, "{e:?}");

    // Mit dem richtigen Altwert geht es.
    let (s, j) = patchen(
        &app,
        &admin,
        einsatz,
        eid,
        json!({
            "verbindungen": [tel, {"mittel": "mobil", "wert": "0170 1"}],
            "erwartet": {"verbindungen": [tel]}
        }),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{j:?}");
}

#[tokio::test]
async fn zweiter_fuehrerwechsel_mit_altwert_ist_409_und_nur_ein_etb_eintrag() {
    let (app, admin, einsatz, eid) = start().await;
    let anna = stammpersonal_disponieren(&app, &admin, einsatz, "Anna").await;
    let bert = stammpersonal_disponieren(&app, &admin, einsatz, "Bert").await;
    personal_zuordnen(&app, &admin, einsatz, eid, anna).await;
    personal_zuordnen(&app, &admin, einsatz, eid, bert).await;
    let etb_vorher = system_etb_anzahl(&app, &admin, einsatz).await;

    let (s, j) = patchen(
        &app,
        &admin,
        einsatz,
        eid,
        json!({"fuehrer_id": anna, "erwartet": {"fuehrer_id": null}}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{j:?}");
    let (s, j) = patchen(
        &app,
        &admin,
        einsatz,
        eid,
        json!({"fuehrer_id": bert, "erwartet": {"fuehrer_id": null}}),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "{j:?}");
    assert_eq!(
        einheit(&app, &admin, einsatz, eid).await["fuehrer_id"],
        anna
    );
    assert_eq!(
        system_etb_anzahl(&app, &admin, einsatz).await,
        etb_vorher + 1,
        "nur der erste Wechsel steht im ETB"
    );
}

#[tokio::test]
async fn ein_feld_veraltet_zwei_gesendet_schreibt_keines() {
    let (app, admin, einsatz, eid) = start().await;
    patchen(&app, &admin, einsatz, eid, json!({"name": "Trupp 2"})).await;
    let (s, j) = patchen(
        &app,
        &admin,
        einsatz,
        eid,
        json!({
            "name": "Trupp 3", "bemerkung": "Tor 3",
            "erwartet": {"name": "Trupp 1", "bemerkung": null}
        }),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "{j:?}");
    let e = einheit(&app, &admin, einsatz, eid).await;
    assert_eq!(e["name"], "Trupp 2");
    assert!(e.get("bemerkung").is_none_or(Value::is_null), "{e:?}");
}

#[tokio::test]
async fn altwert_ohne_aenderung_und_halbes_soll_sind_422() {
    let (app, admin, einsatz, eid) = start().await;
    let (s, _) = patchen(
        &app,
        &admin,
        einsatz,
        eid,
        json!({"bemerkung": "x", "erwartet": {"name": "Trupp 1"}}),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
    let (s, _) = patchen(
        &app,
        &admin,
        einsatz,
        eid,
        json!({
            "soll_fuehrer": 1, "soll_unterfuehrer": 1, "soll_mannschaft": 4,
            "erwartet": {"soll_fuehrer": null}
        }),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn vermerk_an_der_einheit_ohne_etb() {
    let (app, admin, einsatz, eid) = start().await;
    assert!(einheit(&app, &admin, einsatz, eid)
        .await
        .get("vermerke")
        .is_none());
    let etb_vorher = system_etb_anzahl(&app, &admin, einsatz).await;
    let (s, antwort) = patchen(&app, &admin, einsatz, eid, json!({"bemerkung": "Tor 3"})).await;
    assert_eq!(s, StatusCode::OK);
    let v = &einheit(&app, &admin, einsatz, eid).await["vermerke"];
    assert_eq!(v["bemerkung"]["von"], "Administrator", "{v:?}");
    assert!(v.get("name").is_none());
    assert_eq!(antwort["vermerke"], *v);
    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, etb_vorher);

    patchen(
        &app,
        &admin,
        einsatz,
        eid,
        json!({"soll_fuehrer": 1, "soll_unterfuehrer": 1, "soll_mannschaft": 4}),
    )
    .await;
    let v = &einheit(&app, &admin, einsatz, eid).await["vermerke"];
    assert!(
        v.get("soll").is_some(),
        "die Soll-Stärke ist eine Angabe: {v:?}"
    );
}

#[tokio::test]
async fn geerbte_soll_staerke_als_altwert_ist_kein_konflikt() {
    let (app, admin, einsatz, eid) = start().await;
    // Einen Typ mit Soll-Stärke anlegen und zuweisen; die Einheit erbt sie.
    let (s, typ) = anfrage_json(
        &app,
        "POST",
        "/api/einheit-typen",
        &admin,
        Some(&json!({"label": "Prüftrupp LLH-1831", "soll_fuehrer": 1, "soll_unterfuehrer": 1, "soll_mannschaft": 4})),
    )
    .await;
    assert!(s.is_success(), "{s} {typ:?}");
    let typ_id = typ["id"].as_i64().unwrap();
    patchen(&app, &admin, einsatz, eid, json!({"typ_id": typ_id})).await;
    let e = einheit(&app, &admin, einsatz, eid).await;
    assert_eq!(e["soll"]["mannschaft"], 4, "{e:?}");

    // Die Ansicht schickt den wirksamen (geerbten) Wert als Altwert.
    let (s, j) = patchen(
        &app,
        &admin,
        einsatz,
        eid,
        json!({
            "soll_fuehrer": 1, "soll_unterfuehrer": 1, "soll_mannschaft": 6,
            "erwartet": {"soll_fuehrer": 1, "soll_unterfuehrer": 1, "soll_mannschaft": 4}
        }),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{j:?}");
    assert_eq!(
        einheit(&app, &admin, einsatz, eid).await["soll"]["mannschaft"],
        6
    );
}

/// 400 je Feld vor dem 422 der Kombination (`src/AGENTS.md`, Statuscode-Konvention; Review
/// LLH-1831): ein zu langer Altwert ist 400, auch wenn `erwartet` zugleich ein Feld ohne Änderung
/// nennt.
#[tokio::test]
async fn zu_langer_altwert_ist_400_vor_dem_422() {
    let (app, admin, einsatz, eid) = start().await;
    let (s, j) = patchen(
        &app,
        &admin,
        einsatz,
        eid,
        json!({
            "bemerkung": "x",
            "erwartet": {"bemerkung": "y".repeat(5000), "name": "Trupp 1"}
        }),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{j:?}");
}
