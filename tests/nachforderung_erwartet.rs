//! Integrationstests zu LLH-1387 (Specs `nachforderung-einheit`, `bereitstellungsraum-belegung`):
//! erwartete Kräfte aus Nachforderungen mit Ziel = Raum (`GET …/bereitstellungsraeume/{bid}/erwartet`,
//! design.md D1–D3), das Eintreffen mit Verweis auf die Nachforderung (D4) und die Sperre der
//! Rückwege, solange eine Einheit verknüpft ist (D5). Das gekoppelte Gerät prüft
//! `tests/geraet_kopplung.rs`.

use axum::http::StatusCode;
use serde_json::{json, Value};

mod common;
use common::*;

async fn raum(app: &axum::Router, cookie: &str, einsatz: i64, name: &str) -> i64 {
    let (s, j) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/bereitstellungsraeume"),
        cookie,
        Some(&json!({ "bezeichnung": name }).to_string()),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "Raum: {j:?}");
    let br = j["id"].as_i64().unwrap();
    let (s, j) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/bereitstellungsraeume/{br}/status"),
        cookie,
        Some(&json!({ "status": "aktiv" }).to_string()),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "aktiv: {j:?}");
    br
}

/// Eine Nachforderung „<anzahl>× <art>“ mit `extra`; ab „zugesagt“ mit der Zusage `zusage`.
async fn nachforderung(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    art: &str,
    extra: Value,
    zusage: Option<Value>,
    bis: &str,
) -> i64 {
    let mut body = json!({ "art": art, "anzahl": 2, "adressat_kategorie": "leitstelle",
                           "begruendung": "Lage", "bezeichnung": "Details",
                           "adressat_bezeichnung": "ILS Nord" });
    for (k, v) in extra.as_object().unwrap() {
        body[k] = v.clone();
    }
    let (s, n) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/nachforderungen"),
        cookie,
        Some(&body.to_string()),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{n:?}");
    let id = n["id"].as_i64().unwrap();
    if bis == "angefordert" {
        return id;
    }
    let (s, n) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/nachforderungen/{id}/zusage"),
        cookie,
        Some(&zusage.unwrap_or_else(|| json!({})).to_string()),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "Zusage: {n:?}");
    for stufe in ["unterwegs", "eingetroffen"] {
        if bis == "zugesagt" || (bis == "unterwegs" && stufe == "eingetroffen") {
            break;
        }
        status(app, cookie, einsatz, id, stufe, StatusCode::OK).await;
    }
    id
}

async fn status(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    id: i64,
    stufe: &str,
    erwartet: StatusCode,
) -> Value {
    let (s, n) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/nachforderungen/{id}/status"),
        cookie,
        Some(&json!({ "status": stufe }).to_string()),
    )
    .await;
    assert_eq!(s, erwartet, "{stufe}: {n:?}");
    n
}

async fn erwartet(app: &axum::Router, cookie: &str, einsatz: i64, br: i64) -> (StatusCode, Value) {
    anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/bereitstellungsraeume/{br}/erwartet"),
        cookie,
        None,
    )
    .await
}

async fn eintreffen(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    br: i64,
    body: Value,
) -> (StatusCode, Value) {
    anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/bereitstellungsraeume/{br}/eintreffen"),
        cookie,
        Some(&body.to_string()),
    )
    .await
}

async fn lade(app: &axum::Router, cookie: &str, einsatz: i64, id: i64) -> Value {
    let (s, j) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/nachforderungen"),
        cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{j:?}");
    j.as_array()
        .unwrap()
        .iter()
        .find(|n| n["id"] == id)
        .expect("Nachforderung in der Liste")
        .clone()
}

async fn einheit(app: &axum::Router, cookie: &str, einsatz: i64, id: i64) -> Value {
    let (s, j) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/einheiten"),
        cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{j:?}");
    j.as_array()
        .unwrap()
        .iter()
        .find(|x| x["id"] == id)
        .expect("Einheit")
        .clone()
}

async fn etb(app: &axum::Router, cookie: &str, einsatz: i64) -> Vec<Value> {
    let (s, j) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/etb"),
        cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{j:?}");
    j.as_array().unwrap().clone()
}

fn in_einer_stunde() -> String {
    (chrono::Utc::now() + chrono::Duration::hours(1))
        .format("%Y-%m-%d %H:%M:%S")
        .to_string()
}

/// D1/D2: nur Nachforderungen mit Ziel = dieser Raum in „zugesagt“ oder „unterwegs“, ohne
/// Freitexte außer Art und Rufnamen, geordnet nach erwartetem Eintreffen.
#[tokio::test]
async fn projektion_nennt_nur_zugesagte_und_unterwegs_des_raums_ohne_freitexte() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let nord = raum(&app, &admin, e, "Nord").await;
    let sued = raum(&app, &admin, e, "Süd").await;
    let eta = in_einer_stunde();
    let ziel_nord = json!({ "ziel_br_id": nord });

    let unterwegs = nachforderung(
        &app,
        &admin,
        e,
        "RTW",
        ziel_nord.clone(),
        Some(json!({ "rufnamen": ["83-1", "83-2"], "eintreffen_erwartet_at": eta })),
        "unterwegs",
    )
    .await;
    let zugesagt = nachforderung(&app, &admin, e, "SEG", ziel_nord.clone(), None, "zugesagt").await;
    // Nicht dabei: angefordert, eingetroffen, abgelehnt, zurückgezogen, anderer Raum, ohne Ziel.
    nachforderung(
        &app,
        &admin,
        e,
        "KTW",
        ziel_nord.clone(),
        None,
        "angefordert",
    )
    .await;
    nachforderung(
        &app,
        &admin,
        e,
        "GW",
        ziel_nord.clone(),
        None,
        "eingetroffen",
    )
    .await;
    let abgelehnt =
        nachforderung(&app, &admin, e, "ELW", ziel_nord.clone(), None, "zugesagt").await;
    let (s, j) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/nachforderungen/{abgelehnt}/ablehnen"),
        &admin,
        Some(r#"{"grund":"keine"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{j:?}");
    let zurueck = nachforderung(&app, &admin, e, "MTW", ziel_nord.clone(), None, "zugesagt").await;
    let (s, j) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/nachforderungen/{zurueck}/zurueckziehen"),
        &admin,
        Some(r#"{"grund":"erledigt"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{j:?}");
    nachforderung(
        &app,
        &admin,
        e,
        "LF",
        json!({ "ziel_br_id": sued }),
        None,
        "unterwegs",
    )
    .await;
    nachforderung(&app, &admin, e, "DLK", json!({}), None, "unterwegs").await;

    let (s, liste) = erwartet(&app, &admin, e, nord).await;
    assert_eq!(s, StatusCode::OK, "{liste:?}");
    let liste = liste.as_array().unwrap();
    assert_eq!(liste.len(), 2, "{liste:#?}");
    // Mit erwartetem Eintreffen zuerst.
    let a = &liste[0];
    assert_eq!(a["nachforderung_id"], unterwegs);
    assert_eq!(a["art"], "RTW");
    assert_eq!(a["anzahl"], 2);
    assert_eq!(a["status"], "unterwegs");
    assert_eq!(a["rufnamen"], json!(["83-1", "83-2"]));
    assert_eq!(a["offen"], 2);
    assert!(a["eintreffen_erwartet_at"].is_string(), "{a:?}");
    let mut schluessel: Vec<&str> = a.as_object().unwrap().keys().map(String::as_str).collect();
    schluessel.sort_unstable();
    assert_eq!(
        schluessel,
        [
            "anzahl",
            "art",
            "eintreffen_erwartet_at",
            "nachforderung_id",
            "offen",
            "rufnamen",
            "status"
        ],
        "keine Freitexte außer Art und Rufnamen"
    );
    let b = &liste[1];
    assert_eq!(b["nachforderung_id"], zugesagt);
    assert_eq!(b["status"], "zugesagt");
    assert_eq!(b["rufnamen"], json!([]));
    assert!(!b
        .as_object()
        .unwrap()
        .contains_key("eintreffen_erwartet_at"));

    let (s, liste) = erwartet(&app, &admin, e, sued).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(liste.as_array().unwrap().len(), 1, "{liste:?}");

    // Fremder Einsatz: 404.
    let anderer = einsatz_anlegen(&app, &admin).await;
    let (s, _) = erwartet(&app, &admin, anderer, nord).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

/// D3: ohne Freigabe Nachforderungen keine Projektion (403).
#[tokio::test]
async fn projektion_verlangt_die_freigabe_nachforderungen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let nord = raum(&app, &admin, e, "Nord").await;
    let id = benutzer_anlegen(&app, &admin, "fuehrung", "keine").await;
    rolle_setzen(&app, &admin, e, id, "fuehrungspersonal").await;
    let fuehrung = login_cookie(&app, "fuehrung", "fuehrungpw1").await;
    let (s, _) = erwartet(&app, &fuehrung, e, nord).await;
    assert_eq!(s, StatusCode::OK, "mit Freigabe");
    let (s, j) = anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{e}/modul-overrides/nachforderungen"),
        &admin,
        Some(r#"{"sichtbar":false,"benoetigte_rolle":null}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{j:?}");
    let (s, _) = erwartet(&app, &fuehrung, e, nord).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    // Auch das Eintreffen mit Verweis.
    let lf = einheit_bilden(&app, &admin, e, "LF 1").await;
    let (s, _) = eintreffen(
        &app,
        &fuehrung,
        e,
        nord,
        json!({ "kraft": { "objekt_typ": "einheit", "objekt_id": lf }, "nachforderung_id": 1 }),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    assert!(einheit(&app, &admin, e, lf).await["aktueller_br_id"].is_null());
}

/// Akzeptanzkriterium „Buchen einer erwarteten Kraft setzt den Verweis beidseitig“ (D4): eine
/// bekannte Einheit und eine am Raum neu angelegte, je mit Verweis an Einheit und Nachforderung,
/// genau ein ETB-Eintrag je Buchung mit Verweis; der Status bleibt „unterwegs“; was gebucht ist,
/// fällt aus der Projektion.
#[tokio::test]
async fn eintreffen_mit_nachforderung_setzt_den_verweis_beidseitig() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let nord = raum(&app, &admin, e, "Nord").await;
    let n = nachforderung(
        &app,
        &admin,
        e,
        "RTW",
        json!({ "ziel_br_id": nord }),
        Some(json!({ "rufnamen": ["83-1", "83-2"] })),
        "unterwegs",
    )
    .await;
    let bekannt = einheit_bilden(&app, &admin, e, "83-1").await;

    // Bekannte Einheit.
    let vorher = etb(&app, &admin, e).await.len();
    let (s, j) = eintreffen(
        &app,
        &admin,
        e,
        nord,
        json!({ "kraft": { "objekt_typ": "einheit", "objekt_id": bekannt },
                "nachforderung_id": n }),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{j:?}");
    assert_eq!(
        einheit(&app, &admin, e, bekannt).await["nachforderung_id"],
        n
    );
    assert_eq!(
        einheit(&app, &admin, e, bekannt).await["aktueller_br_id"],
        nord
    );
    let nach = etb(&app, &admin, e).await;
    assert_eq!(nach.len(), vorher + 1, "genau ein ETB-Eintrag: {nach:#?}");
    let eintrag = nach
        .iter()
        .find(|x| x["inhalt"] == "Nachforderung 2× RTW: 83-1 im BR Nord eingetroffen")
        .unwrap_or_else(|| panic!("ETB-Eintrag mit Nachforderung: {nach:#?}"));
    assert_eq!(eintrag["nachforderung_id"], n);
    let nf = lade(&app, &admin, e, n).await;
    assert_eq!(
        nf["einheit_ids"],
        json!([bekannt]),
        "Verweis an der Nachforderung"
    );
    assert_eq!(
        nf["status"], "unterwegs",
        "Eintreffen melden bleibt der Führung"
    );

    let (_, liste) = erwartet(&app, &admin, e, nord).await;
    assert_eq!(liste[0]["rufnamen"], json!(["83-2"]), "{liste:?}");
    assert_eq!(liste[0]["offen"], 1);

    // Unangemeldet mit Verweis: Meldung nennt die Nachforderung.
    let vorher = etb(&app, &admin, e).await.len();
    let (s, j) = eintreffen(
        &app,
        &admin,
        e,
        nord,
        json!({ "unangemeldet": { "fahrzeuge": [{ "funkrufname": "83-2", "fahrzeugtyp": "RTW" }] },
                "nachforderung_id": n }),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{j:?}");
    assert_eq!(j["unangemeldet"], true);
    let neu = j["einheit_id"].as_i64().unwrap();
    let x = einheit(&app, &admin, e, neu).await;
    assert_eq!(x["nachforderung_id"], n);
    assert!(
        x["nicht_uebernommen_seit"].is_string(),
        "Übernahme bleibt offen: {x:?}"
    );
    let nach = etb(&app, &admin, e).await;
    assert_eq!(nach.len(), vorher + 1, "genau ein ETB-Eintrag: {nach:#?}");
    let eintrag = nach
        .iter()
        .find(|x| {
            x["inhalt"]
                .as_str()
                .is_some_and(|i| i.starts_with("83-2 (RTW) aus Nachforderung 2× RTW im BR Nord"))
        })
        .unwrap_or_else(|| panic!("Meldungseintrag: {nach:#?}"));
    assert_eq!(eintrag["nachforderung_id"], n);
    let nf = lade(&app, &admin, e, n).await;
    assert_eq!(nf["einheit_ids"], json!([bekannt, neu]));

    // Die Anzahl ist erreicht: nicht mehr erwartet, eine dritte Buchung 422.
    let (_, liste) = erwartet(&app, &admin, e, nord).await;
    assert_eq!(liste, json!([]));
    let dritte = einheit_bilden(&app, &admin, e, "83-3").await;
    let (s, j) = eintreffen(
        &app,
        &admin,
        e,
        nord,
        json!({ "kraft": { "objekt_typ": "einheit", "objekt_id": dritte },
                "nachforderung_id": n }),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{j:?}");
    assert!(einheit(&app, &admin, e, dritte).await["aktueller_br_id"].is_null());

    // Danach geht „Eintreffen melden“ wie bisher, und die Übernahme zählt die Verknüpften mit.
    status(&app, &admin, e, n, "eingetroffen", StatusCode::OK).await;
    let (s, j) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/einheiten/aus-nachforderung"),
        &admin,
        Some(&json!({ "nachforderung_id": n, "einheiten": [{ "name": "83-9" }] }).to_string()),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{j:?}");
}

/// LLH-1396: der Warnweg der Doppelbuchung (D9) verliert den Verweis nicht. Die erste Buchung
/// scheitert mit 422 und verknüpft nichts; „Diese buchen“ (bekannte Kraft) und „Trotzdem neu
/// anlegen“ (`trotzdem_anlegen`) tragen beide `nachforderung_id` an die Einheit.
#[tokio::test]
async fn doppelbuchungs_warnweg_behaelt_den_verweis() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let nord = raum(&app, &admin, e, "Nord").await;
    let n = nachforderung(
        &app,
        &admin,
        e,
        "RTW",
        json!({ "ziel_br_id": nord }),
        Some(json!({ "rufnamen": ["83-1", "83-2"] })),
        "unterwegs",
    )
    .await;
    let bekannt = einheit_bilden(&app, &admin, e, "83-1").await;
    let unangemeldet = |trotzdem: bool| {
        json!({ "unangemeldet": { "fahrzeuge": [{ "funkrufname": "83-1", "fahrzeugtyp": "RTW" }],
                                  "trotzdem_anlegen": trotzdem },
                "nachforderung_id": n })
    };

    // Warnung: gleichnamige Kraft im Einsatz, nichts gebucht, nichts verknüpft.
    let (s, j) = eintreffen(&app, &admin, e, nord, unangemeldet(false)).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{j:?}");
    assert_eq!(lade(&app, &admin, e, n).await["einheit_ids"], json!([]));

    // „Diese buchen“: die bekannte Kraft mit Verweis.
    let (s, j) = eintreffen(
        &app,
        &admin,
        e,
        nord,
        json!({ "kraft": { "objekt_typ": "einheit", "objekt_id": bekannt },
                "nachforderung_id": n }),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{j:?}");
    let x = einheit(&app, &admin, e, bekannt).await;
    assert_eq!(x["nachforderung_id"], n, "{x:?}");
    assert_eq!(x["aktueller_br_id"], nord);

    // „Trotzdem neu anlegen“: die neue Einheit trägt den Verweis ebenso.
    let (s, j) = eintreffen(&app, &admin, e, nord, unangemeldet(true)).await;
    assert_eq!(s, StatusCode::CREATED, "{j:?}");
    let neu = j["einheit_id"].as_i64().unwrap();
    assert_eq!(einheit(&app, &admin, e, neu).await["nachforderung_id"], n);
    assert_eq!(
        lade(&app, &admin, e, n).await["einheit_ids"],
        json!([bekannt, neu])
    );
}

/// D4 Prüfkette: fremder Raum und fremder Einsatz 404; angefordert 422; Einheit schon aus einer
/// anderen Nachforderung 409. Nichts wird gebucht. (Ein Fahrzeug ohne Einheit ist seit LLH-1444
/// kein 422 mehr, siehe `fahrzeug_ohne_einheit_wird_mit_verweis_zur_einheit`.)
#[tokio::test]
async fn pruefkette_des_verweises() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let nord = raum(&app, &admin, e, "Nord").await;
    let sued = raum(&app, &admin, e, "Süd").await;
    let ziel = json!({ "ziel_br_id": nord });
    let n = nachforderung(&app, &admin, e, "RTW", ziel.clone(), None, "unterwegs").await;
    let angefordert =
        nachforderung(&app, &admin, e, "KTW", ziel.clone(), None, "angefordert").await;
    let anderer_einsatz = einsatz_anlegen(&app, &admin).await;
    let fremd = nachforderung(
        &app,
        &admin,
        anderer_einsatz,
        "RTW",
        json!({}),
        None,
        "unterwegs",
    )
    .await;
    let lf = einheit_bilden(&app, &admin, e, "LF 1").await;
    let kraft = |nid: i64| json!({ "kraft": { "objekt_typ": "einheit", "objekt_id": lf }, "nachforderung_id": nid });

    let (s, _) = eintreffen(&app, &admin, e, sued, kraft(n)).await;
    assert_eq!(s, StatusCode::NOT_FOUND, "Ziel ist ein anderer Raum");
    let (s, _) = eintreffen(&app, &admin, e, nord, kraft(fremd)).await;
    assert_eq!(s, StatusCode::NOT_FOUND, "anderer Einsatz");
    let (s, j) = eintreffen(&app, &admin, e, nord, kraft(angefordert)).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "angefordert: {j:?}");
    assert!(einheit(&app, &admin, e, lf).await["aktueller_br_id"].is_null());
    assert!(einheit(&app, &admin, e, lf).await["nachforderung_id"].is_null());

    // Schon aus einer anderen Nachforderung: 409.
    let zweite = nachforderung(&app, &admin, e, "NEF", ziel.clone(), None, "unterwegs").await;
    let (s, j) = eintreffen(&app, &admin, e, nord, kraft(n)).await;
    assert_eq!(s, StatusCode::CREATED, "{j:?}");
    let (s, j) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/bereitstellungsraeume/{nord}/belegung"),
        &admin,
        Some(&json!({ "objekt_typ": "einheit", "objekt_id": lf, "art": "austritt" }).to_string()),
    )
    .await;
    assert!(s.is_success(), "Austritt: {s} {j:?}");
    let (s, j) = eintreffen(&app, &admin, e, nord, kraft(zweite)).await;
    assert_eq!(s, StatusCode::CONFLICT, "{j:?}");
    assert!(einheit(&app, &admin, e, lf).await["aktueller_br_id"].is_null());
    assert_eq!(einheit(&app, &admin, e, lf).await["nachforderung_id"], n);
    // Dieselbe Nachforderung noch einmal: kein Fehler, kein zweiter Verweis.
    let (s, j) = eintreffen(&app, &admin, e, nord, kraft(n)).await;
    assert_eq!(s, StatusCode::CREATED, "{j:?}");
    assert_eq!(lade(&app, &admin, e, n).await["einheit_ids"], json!([lf]));
}

async fn adhoc_fahrzeug(app: &axum::Router, cookie: &str, einsatz: i64, funkrufname: &str) -> i64 {
    let (s, j) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/fahrzeuge"),
        cookie,
        Some(&json!({ "adhoc": { "funkrufname": funkrufname } }).to_string()),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "Fahrzeug: {j:?}");
    j["id"].as_i64().unwrap()
}

async fn einheit_von(pool: &sqlx::SqlitePool, tabelle: &str, id: i64) -> Option<i64> {
    sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
        "SELECT einheit_id FROM {tabelle} WHERE id = ?"
    )))
    .bind(id)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn einheiten_anzahl(pool: &sqlx::SqlitePool, einsatz: i64) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_einheit WHERE einsatz_id = ?")
        .bind(einsatz)
        .fetch_one(pool)
        .await
        .unwrap()
}

/// LLH-1444 (Entscheidung 23.10.2026): ein Fahrzeug ohne Einheit mit Verweis auf eine
/// Nachforderung wird in derselben Transaktion zur Einheit (Name = Funkrufname, Besatzung ohne
/// Einheit kommt mit), die Einheit tritt in den Raum ein, verweist auf die Nachforderung und steht
/// unter ihren Einheiten; genau ein ETB-Eintrag mit Verweis. Eine Wiederholung derselben
/// `client_id` legt nichts zweites an. Ohne Verweis bleibt es der Eintritt des Fahrzeugs; ein
/// Fahrzeug, das schon in einem Raum steht, ist 409 und legt keine Einheit an.
#[tokio::test]
async fn fahrzeug_ohne_einheit_wird_mit_verweis_zur_einheit() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let nord = raum(&app, &admin, e, "Nord").await;
    let n = nachforderung(
        &app,
        &admin,
        e,
        "RTW",
        json!({ "ziel_br_id": nord }),
        Some(json!({ "rufnamen": ["RTW 2", "RTW 3"] })),
        "unterwegs",
    )
    .await;
    let ef = adhoc_fahrzeug(&app, &admin, e, "RTW 2").await;
    let anna = stammpersonal_disponieren(&app, &admin, e, "Anna").await;
    let (s, j) = anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{e}/fahrzeuge/{ef}/besatzung/{anna}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT, "Besatzung: {j:?}");
    let vorher = etb(&app, &admin, e).await.len();
    let einheiten_vorher = einheiten_anzahl(&pool, e).await;
    let body = json!({ "kraft": { "objekt_typ": "fahrzeug", "objekt_id": ef },
                       "nachforderung_id": n, "client_id": "llh-1444-a" });

    let (s, j) = eintreffen(&app, &admin, e, nord, body.clone()).await;
    assert_eq!(s, StatusCode::CREATED, "{j:?}");
    let neu = j["einheit_id"].as_i64().expect("Einheit angelegt");
    assert_eq!(j["belegung"]["objekt_typ"], "einheit", "{j:?}");
    assert_eq!(j["belegung"]["objekt_id"], neu);
    assert_eq!(j["fahrzeug_ids"], json!([ef]));
    assert_eq!(j["zeitachse"], "geschrieben");
    assert_eq!(j["unangemeldet"], false);
    assert_eq!(einheiten_anzahl(&pool, e).await, einheiten_vorher + 1);

    let x = einheit(&app, &admin, e, neu).await;
    assert_eq!(x["name"], "RTW 2");
    assert_eq!(x["funkrufname"], "RTW 2");
    assert_eq!(x["nachforderung_id"], n);
    assert_eq!(x["aktueller_br_id"], nord);
    assert!(
        x["nicht_uebernommen_seit"].is_null(),
        "bekannte Kraft, keine offene Übernahme: {x:?}"
    );
    assert_eq!(einheit_von(&pool, "einsatz_fahrzeug", ef).await, Some(neu));
    assert_eq!(
        einheit_von(&pool, "einsatz_personal", anna).await,
        Some(neu)
    );
    let fahrzeug_br: Option<i64> =
        sqlx::query_scalar("SELECT aktueller_br_id FROM einsatz_fahrzeug WHERE id = ?")
            .bind(ef)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        fahrzeug_br, None,
        "im Raum steht die Einheit, nicht das Fahrzeug"
    );

    let nf = lade(&app, &admin, e, n).await;
    assert_eq!(
        nf["einheit_ids"],
        json!([neu]),
        "die Nachforderung zählt die Kraft"
    );
    assert_eq!(
        nf["status"], "unterwegs",
        "Eintreffen melden bleibt der Führung"
    );
    let nach = etb(&app, &admin, e).await;
    assert_eq!(nach.len(), vorher + 1, "genau ein ETB-Eintrag: {nach:#?}");
    let eintrag = nach
        .iter()
        .find(|x| {
            x["inhalt"]
                == "Nachforderung 2× RTW: Fahrzeug RTW 2 als Einheit übernommen, im BR Nord \
                    eingetroffen, Besatzung: Anna"
        })
        .unwrap_or_else(|| panic!("ETB-Eintrag mit Nachforderung: {nach:#?}"));
    assert_eq!(eintrag["nachforderung_id"], n);

    // Wiederholung aus der Warteschlange: dasselbe Ergebnis, nichts Zweites.
    let (s, w) = eintreffen(&app, &admin, e, nord, body).await;
    assert_eq!(s, StatusCode::CREATED, "{w:?}");
    assert_eq!(w["einheit_id"], neu);
    assert_eq!(einheiten_anzahl(&pool, e).await, einheiten_vorher + 1);
    assert_eq!(etb(&app, &admin, e).await.len(), vorher + 1);

    // Ohne Verweis wie bisher: das Fahrzeug selbst tritt ein, keine Einheit.
    let drei = adhoc_fahrzeug(&app, &admin, e, "RTW 3").await;
    let (s, j) = eintreffen(
        &app,
        &admin,
        e,
        nord,
        json!({ "kraft": { "objekt_typ": "fahrzeug", "objekt_id": drei } }),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{j:?}");
    assert!(j.get("einheit_id").is_none(), "{j:?}");
    assert_eq!(j["belegung"]["objekt_typ"], "fahrzeug");
    assert_eq!(einheit_von(&pool, "einsatz_fahrzeug", drei).await, None);
    assert_eq!(einheiten_anzahl(&pool, e).await, einheiten_vorher + 1);

    // Schon in einem Raum: 409 wie beim Eintritt, keine Einheit, kein Verweis.
    let (s, j) = eintreffen(
        &app,
        &admin,
        e,
        nord,
        json!({ "kraft": { "objekt_typ": "fahrzeug", "objekt_id": drei }, "nachforderung_id": n }),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "{j:?}");
    assert_eq!(einheit_von(&pool, "einsatz_fahrzeug", drei).await, None);
    assert_eq!(einheiten_anzahl(&pool, e).await, einheiten_vorher + 1);
    assert_eq!(lade(&app, &admin, e, n).await["einheit_ids"], json!([neu]));
}

/// D5: mit verknüpfter Einheit vor dem Eintreffen gehen Rücknahme, Ablehnen und Zurückziehen
/// nicht, die Anzahl nicht unter die Verknüpften; vorwärts bleibt frei.
#[tokio::test]
async fn mit_verknuepfter_einheit_nur_noch_vorwaerts() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let nord = raum(&app, &admin, e, "Nord").await;
    let n = nachforderung(
        &app,
        &admin,
        e,
        "RTW",
        json!({ "ziel_br_id": nord }),
        Some(json!({ "rufnamen": ["83-1"] })),
        "zugesagt",
    )
    .await;
    let lf = einheit_bilden(&app, &admin, e, "83-1").await;
    let (s, j) = eintreffen(
        &app,
        &admin,
        e,
        nord,
        json!({ "kraft": { "objekt_typ": "einheit", "objekt_id": lf }, "nachforderung_id": n }),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{j:?}");

    let j = status(
        &app,
        &admin,
        e,
        n,
        "angefordert",
        StatusCode::UNPROCESSABLE_ENTITY,
    )
    .await;
    assert!(
        j["error"]
            .as_str()
            .is_some_and(|t| t.contains("Einheiten übernommen")),
        "{j:?}"
    );
    for (pfad, body) in [("ablehnen", r#"{"grund":"x"}"#), ("zurueckziehen", r#"{}"#)] {
        let (s, j) = anfrage(
            &app,
            "POST",
            &format!("/api/einsaetze/{e}/nachforderungen/{n}/{pfad}"),
            &admin,
            Some(body),
        )
        .await;
        assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{pfad}: {j:?}");
    }
    let (s, j) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{e}/nachforderungen/{n}"),
        &admin,
        Some(r#"{"anzahl":1}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "Anzahl = Verknüpfte geht: {j:?}");
    let (s, j) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{e}/nachforderungen/{n}"),
        &admin,
        Some(r#"{"anzahl":3}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{j:?}");
    // Unter die Zahl der Verknüpften geht es nicht: zweite verknüpfen, dann auf 1.
    let zweite = einheit_bilden(&app, &admin, e, "83-2").await;
    let (s, j) = eintreffen(
        &app,
        &admin,
        e,
        nord,
        json!({ "kraft": { "objekt_typ": "einheit", "objekt_id": zweite }, "nachforderung_id": n }),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{j:?}");
    let (s, j) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{e}/nachforderungen/{n}"),
        &admin,
        Some(r#"{"anzahl":1}"#),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{j:?}");

    status(&app, &admin, e, n, "unterwegs", StatusCode::OK).await;
    status(
        &app,
        &admin,
        e,
        n,
        "zugesagt",
        StatusCode::UNPROCESSABLE_ENTITY,
    )
    .await;
    status(&app, &admin, e, n, "eingetroffen", StatusCode::OK).await;
    assert_eq!(lade(&app, &admin, e, n).await["status"], "eingetroffen");
}
