//! Integrationstests zu LLH-1573: Rettungsmittel für einen Patienten anfordern. Eine
//! Nachforderung verweist auf die Person (`person_id`), die Zusage trägt die Einsatznummer der
//! Leitstelle, und die Personenantwort zeigt den Stand (`rettungsmittel`).
//!
//! Die Schwärzung prüft `einsatz::purge_scheduler`, die Spalten `db::tests::migration_0289_*`.

use axum::http::StatusCode;
use serde_json::Value;

mod common;
use common::*;

fn nachforderungen(einsatz: i64) -> String {
    format!("/api/einsaetze/{einsatz}/nachforderungen")
}

/// „RTW“ für eine Person, mit zusätzlichen Feldern aus `extra`.
async fn anfordern(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    person: Option<i64>,
    extra: Value,
) -> (StatusCode, Value) {
    let mut body = serde_json::json!({
        "art": "RTW", "adressat_kategorie": "leitstelle", "begruendung": "Für R-1"
    });
    if let Some(pid) = person {
        body["person_id"] = pid.into();
    }
    for (k, v) in extra.as_object().unwrap() {
        body[k] = v.clone();
    }
    anfrage(
        app,
        "POST",
        &nachforderungen(einsatz),
        cookie,
        Some(&body.to_string()),
    )
    .await
}

async fn person(app: &axum::Router, cookie: &str, einsatz: i64, pid: i64) -> Value {
    let (s, json) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/personen/{pid}"),
        cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{json:?}");
    json
}

async fn liste(app: &axum::Router, cookie: &str, einsatz: i64) -> Vec<Value> {
    let (s, json) = anfrage(app, "GET", &nachforderungen(einsatz), cookie, None).await;
    assert_eq!(s, StatusCode::OK, "{json:?}");
    json.as_array().unwrap().clone()
}

async fn post(app: &axum::Router, cookie: &str, pfad: &str, body: Value) -> (StatusCode, Value) {
    anfrage(app, "POST", pfad, cookie, Some(&body.to_string())).await
}

async fn modul_ausblenden(app: &axum::Router, admin: &str, einsatz: i64, modul: &str) {
    let (s, j) = anfrage(
        app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/modul-overrides/{modul}"),
        admin,
        Some(r#"{"sichtbar":false,"benoetigte_rolle":null}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "Override {modul}: {j:?}");
}

/// Eine Führungskraft im Einsatz (Schreibrecht, kein Admin — Admins sehen jedes Modul).
async fn fuehrung(app: &axum::Router, admin: &str, einsatz: i64, name: &str) -> String {
    let id = benutzer_anlegen(app, admin, name, "keine").await;
    rolle_setzen(app, admin, einsatz, id, "fuehrungspersonal").await;
    login_cookie(app, name, &format!("{name}pw1")).await
}

#[tokio::test]
async fn anforderung_fuer_eine_person_traegt_bezug_und_registriernummer() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let pid = person_anlegen(&app, &admin, e, "{}").await;
    let reg = person(&app, &admin, e, pid).await["registrier_nr"].clone();

    let (s, n) = anfordern(&app, &admin, e, Some(pid), serde_json::json!({})).await;
    assert_eq!(s, StatusCode::CREATED, "{n:?}");
    assert_eq!(n["person_id"], pid);
    assert_eq!(n["person_registrier_nr"], reg);
    // Ohne Angabe wird ein Rettungsmittel angefordert (design.md D1).
    assert_eq!(n["anzahl"], 1);
    assert!(n.get("leitstelle_einsatznummer").is_none(), "{n:?}");

    let alle = liste(&app, &admin, e).await;
    assert_eq!(alle[0]["person_id"], pid);

    // Ohne Bezug fehlen die Schlüssel.
    let (s, ohne) = anfordern(&app, &admin, e, None, serde_json::json!({"anzahl": 2})).await;
    assert_eq!(s, StatusCode::CREATED, "{ohne:?}");
    let o = ohne.as_object().unwrap();
    assert!(!o.contains_key("person_id") && !o.contains_key("person_registrier_nr"));
}

#[tokio::test]
async fn mehr_als_ein_rettungsmittel_oder_zweiter_bezug_ist_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let pid = person_anlegen(&app, &admin, e, "{}").await;
    let (s, j) = post(
        &app,
        &admin,
        &format!("/api/einsaetze/{e}/betreuung/stellen"),
        serde_json::json!({"bezeichnung": "NU", "art": "notunterkunft"}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{j:?}");
    let stelle = j["id"].as_i64().unwrap();

    let (s, j) = anfordern(&app, &admin, e, Some(pid), serde_json::json!({"anzahl": 2})).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{j:?}");
    let (s, j) = anfordern(
        &app,
        &admin,
        e,
        Some(pid),
        serde_json::json!({"betreuungsstelle_id": stelle}),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{j:?}");
    assert!(liste(&app, &admin, e).await.is_empty(), "nichts angelegt");
}

#[tokio::test]
async fn fremde_unbekannte_und_stornierte_person_sind_404_und_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let fremder = einsatz_anlegen(&app, &admin).await;
    let fremde = person_anlegen(&app, &admin, fremder, "{}").await;
    for pid in [fremde, 999_999] {
        let (s, j) = anfordern(&app, &admin, e, Some(pid), serde_json::json!({})).await;
        assert_eq!(s, StatusCode::NOT_FOUND, "Person {pid}: {j:?}");
    }

    let pid = person_anlegen(&app, &admin, e, "{}").await;
    let (s, _) = anfrage(
        &app,
        "DELETE",
        &format!("/api/einsaetze/{e}/personen/{pid}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let (s, j) = anfordern(&app, &admin, e, Some(pid), serde_json::json!({})).await;
    assert_eq!(s, StatusCode::CONFLICT, "{j:?}");
    assert!(liste(&app, &admin, e).await.is_empty(), "nichts angelegt");
}

/// Ohne Lesezugriff auf das Modul Personen: 403, auch für eine Person, die es nicht gibt (sonst
/// verriete 404 gegen 409 die Existenz). Ohne Bezug bleibt die Nachforderung möglich.
#[tokio::test]
async fn ohne_personenrecht_ist_bezug_403_auch_fuer_unbekannte_person() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let pid = person_anlegen(&app, &admin, e, "{}").await;
    let frieda = fuehrung(&app, &admin, e, "frieda").await;
    modul_ausblenden(&app, &admin, e, "personen").await;

    for ziel in [pid, 999_999] {
        let (s, j) = anfordern(&app, &frieda, e, Some(ziel), serde_json::json!({})).await;
        assert_eq!(s, StatusCode::FORBIDDEN, "Person {ziel}: {j:?}");
    }
    let (s, j) = anfordern(&app, &frieda, e, None, serde_json::json!({})).await;
    assert_eq!(
        s,
        StatusCode::CREATED,
        "ohne Bezug kein Personenrecht nötig: {j:?}"
    );
}

/// design.md D4–D6: die Personenantwort folgt dem Stand der jüngsten Nachforderung; Zusage mit
/// Rufname und Einsatznummer, Eintreffen; eine zurückgezogene verschwindet, eine abgelehnte
/// bleibt sichtbar.
#[tokio::test]
async fn person_zeigt_den_stand_des_rettungsmittels() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let pid = person_anlegen(&app, &admin, e, "{}").await;
    assert!(person(&app, &admin, e, pid)
        .await
        .get("rettungsmittel")
        .is_none());

    let (_, n) = anfordern(&app, &admin, e, Some(pid), serde_json::json!({})).await;
    let nid = n["id"].as_i64().unwrap();
    let r = &person(&app, &admin, e, pid).await["rettungsmittel"];
    assert_eq!(r["nachforderung_id"], nid);
    assert_eq!(r["art"], "RTW");
    assert_eq!(r["status"], "angefordert");
    assert_eq!(r["rufnamen"], serde_json::json!([]));

    let (s, z) = post(
        &app,
        &admin,
        &format!("{}/{nid}/zusage", nachforderungen(e)),
        serde_json::json!({"rufnamen": ["RTW 1/83-1"], "leitstelle_einsatznummer": " 2611-0815 "}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{z:?}");
    assert_eq!(z["leitstelle_einsatznummer"], "2611-0815");
    for stufe in ["unterwegs", "eingetroffen"] {
        let (s, j) = post(
            &app,
            &admin,
            &format!("{}/{nid}/status", nachforderungen(e)),
            serde_json::json!({"status": stufe}),
        )
        .await;
        assert_eq!(s, StatusCode::OK, "{stufe}: {j:?}");
    }
    let r = &person(&app, &admin, e, pid).await["rettungsmittel"];
    assert_eq!(r["status"], "eingetroffen");
    assert_eq!(r["rufnamen"], serde_json::json!(["RTW 1/83-1"]));
    assert_eq!(r["leitstelle_einsatznummer"], "2611-0815");

    // Eine zweite, abgelehnte Anforderung ist die jüngste und bleibt sichtbar.
    let (_, n2) = anfordern(
        &app,
        &admin,
        e,
        Some(pid),
        serde_json::json!({"art": "NEF"}),
    )
    .await;
    let nid2 = n2["id"].as_i64().unwrap();
    let (s, _) = post(
        &app,
        &admin,
        &format!("{}/{nid2}/ablehnen", nachforderungen(e)),
        serde_json::json!({}),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let r = &person(&app, &admin, e, pid).await["rettungsmittel"];
    assert_eq!(
        (r["art"].as_str(), r["status"].as_str()),
        (Some("NEF"), Some("abgelehnt"))
    );

    // Eine zurückgezogene zählt nicht: der Stand fällt auf die vorige zurück.
    let (_, n3) = anfordern(
        &app,
        &admin,
        e,
        Some(pid),
        serde_json::json!({"art": "KTW"}),
    )
    .await;
    let nid3 = n3["id"].as_i64().unwrap();
    let (s, _) = post(
        &app,
        &admin,
        &format!("{}/{nid3}/zurueckziehen", nachforderungen(e)),
        serde_json::json!({}),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let r = &person(&app, &admin, e, pid).await["rettungsmittel"];
    assert_eq!(r["nachforderung_id"], nid2);
}

/// design.md D5: die Einsatznummer gibt es nur mit Personenbezug, sie gehört zur Zusage und steht
/// nie im ETB-Wortlaut.
#[tokio::test]
async fn einsatznummer_nur_mit_personenbezug_und_nicht_im_etb() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (_, ohne) = anfordern(&app, &admin, e, None, serde_json::json!({})).await;
    let ohne_id = ohne["id"].as_i64().unwrap();
    let (s, j) = post(
        &app,
        &admin,
        &format!("{}/{ohne_id}/zusage", nachforderungen(e)),
        serde_json::json!({"leitstelle_einsatznummer": "4711"}),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{j:?}");

    let pid = person_anlegen(&app, &admin, e, "{}").await;
    let (_, n) = anfordern(&app, &admin, e, Some(pid), serde_json::json!({})).await;
    let nid = n["id"].as_i64().unwrap();
    let zu_lang = "9".repeat(51);
    let (s, j) = post(
        &app,
        &admin,
        &format!("{}/{nid}/zusage", nachforderungen(e)),
        serde_json::json!({"leitstelle_einsatznummer": zu_lang}),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{j:?}");
    // Vor der Zusage gehört sie nicht ins Bearbeiten.
    let (s, j) = anfrage(
        &app,
        "PATCH",
        &format!("{}/{nid}", nachforderungen(e)),
        &admin,
        Some(r#"{"leitstelle_einsatznummer":"4711"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{j:?}");

    let (s, _) = post(
        &app,
        &admin,
        &format!("{}/{nid}/zusage", nachforderungen(e)),
        serde_json::json!({}),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (s, j) = anfrage(
        &app,
        "PATCH",
        &format!("{}/{nid}", nachforderungen(e)),
        &admin,
        Some(r#"{"leitstelle_einsatznummer":"4711-0815"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{j:?}");
    assert_eq!(j["leitstelle_einsatznummer"], "4711-0815");
    // Mehr als ein Rettungsmittel auch im Bearbeiten nicht.
    let (s, j) = anfrage(
        &app,
        "PATCH",
        &format!("{}/{nid}", nachforderungen(e)),
        &admin,
        Some(r#"{"anzahl":2}"#),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{j:?}");

    let (s, etb) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/etb"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let text = etb.to_string();
    assert!(
        !text.contains("4711-0815"),
        "Einsatznummer nie im ETB: {text}"
    );
    assert!(
        text.contains("Einsatznummer der Leitstelle nachgetragen"),
        "Nachtrag ohne Wert im ETB: {text}"
    );
}
