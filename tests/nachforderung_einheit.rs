//! Integrationstests zu LLH-1383 (Teil b zu LLH-1097, Spec `nachforderung-einheit`): eine
//! eingetroffene Nachforderung als Einheit übernehmen und in den Bereitstellungsraum ihres Ziels
//! buchen. Geprüft werden der Weg „Eintreffen melden“ → „Als Einheit übernehmen“ mit Ziel BR Nord
//! (Einheit, Belegung, Zeitachse, Verweis beidseitig, ein ETB-Eintrag), die Prüfkette
//! (design.md D2), das Verknüpfen bestehender Einheiten (D3) und die Rücknahmesperre (D8).
//! Dazu der Storno einer Fehlübernahme samt Raumbuchung (LLH-1388, design.md D1–D6).
//!
//! Die Spalte prüft `db::tests::migration_0239_*`, den ETB-Wortlaut `einheit::aus_nachforderung`.

use axum::http::StatusCode;
use serde_json::{json, Value};

mod common;
use common::*;

fn url(einsatz: i64) -> String {
    format!("/api/einsaetze/{einsatz}/einheiten/aus-nachforderung")
}

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

/// „2× RTW“ an die Leitstelle mit `extra`, bis zur Stufe `bis` geschaltet; mit Zusage „83-1“,
/// „83-2“, sobald `bis` über „angefordert“ hinausgeht.
async fn nachforderung(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    extra: Value,
    bis: &str,
) -> i64 {
    let mut body = json!({ "art": "RTW", "anzahl": 2, "adressat_kategorie": "leitstelle" });
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
        Some(&json!({ "rufnamen": ["83-1", "83-2"] }).to_string()),
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

async fn uebernehmen(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    body: Value,
) -> (StatusCode, Value) {
    anfrage(app, "POST", &url(einsatz), cookie, Some(&body.to_string())).await
}

async fn einheiten(app: &axum::Router, cookie: &str, einsatz: i64) -> Vec<Value> {
    let (s, j) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/einheiten"),
        cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{j:?}");
    j.as_array().unwrap().clone()
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

/// Eine Führungskraft im Einsatz (Schreibrecht, kein Admin — Admins sehen jedes Modul).
async fn fuehrung(app: &axum::Router, admin: &str, einsatz: i64, name: &str) -> String {
    let id = benutzer_anlegen(app, admin, name, "keine").await;
    rolle_setzen(app, admin, einsatz, id, "fuehrungspersonal").await;
    login_cookie(app, name, &format!("{name}pw1")).await
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

/// Akzeptanzkriterium (Spec „Eingetroffene Nachforderung als Einheit übernehmen“): „Eintreffen
/// melden“ und „Als Einheit übernehmen“ mit Ziel BR Nord → je Rufname eine Einheit im Einsatz,
/// Belegung und Eintreffen im Raum, Verweis an Einheit und Nachforderung, genau ein ETB-Eintrag.
#[tokio::test]
async fn eintreffen_und_uebernahme_mit_ziel_br_nord() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let nord = raum(&app, &admin, e, "Nord").await;
    let n = nachforderung(
        &app,
        &admin,
        e,
        json!({ "ziel_br_id": nord }),
        "eingetroffen",
    )
    .await;
    let (s, typ) = anfrage(
        &app,
        "POST",
        "/api/einheit-typen",
        &admin,
        Some(&json!({ "label": "RTW" }).to_string()),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{typ:?}");
    let typ_id = typ["id"].as_i64().unwrap();
    let vorher = etb(&app, &admin, e).await.len();

    let (s, antwort) = uebernehmen(
        &app,
        &admin,
        e,
        json!({
            "nachforderung_id": n,
            "einheiten": [{ "name": "83-1" }, { "name": " 83-2 " }],
            "typ_id": typ_id,
            "in_bereitstellungsraum": true,
        }),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{antwort:?}");
    assert_eq!(antwort["id"], n);
    assert_eq!(antwort["status"], "eingetroffen");
    let ids: Vec<i64> = antwort["einheit_ids"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_i64().unwrap())
        .collect();
    assert_eq!(ids.len(), 2, "{antwort:?}");

    // Einheit im Einsatz, im Raum, mit Herkunft.
    let alle = einheiten(&app, &admin, e).await;
    for (id, name) in ids.iter().zip(["83-1", "83-2"]) {
        let einheit = alle.iter().find(|x| x["id"] == *id).expect("Einheit");
        assert_eq!(einheit["name"], name);
        assert_eq!(einheit["funkrufname"], name);
        assert_eq!(einheit["typ_id"], typ_id);
        assert_eq!(einheit["nachforderung_id"], n, "Verweis an der Einheit");
        assert_eq!(einheit["aktueller_br_id"], nord, "im BR Nord");
        // Eintreffen in der Zeitachse, Quelle Bereitstellungsraum, zum Zeitpunkt des Eintreffens.
        let (s, z) = anfrage(
            &app,
            "GET",
            &format!("/api/einsaetze/{e}/einheiten/{id}/zeitachse"),
            &admin,
            None,
        )
        .await;
        assert_eq!(s, StatusCode::OK, "{z:?}");
        let ereignisse = z["ereignisse"].as_array().unwrap();
        assert_eq!(ereignisse.len(), 1, "{z:?}");
        assert_eq!(ereignisse[0]["art"], "eintreffen");
        assert_eq!(ereignisse[0]["quelle"], "bereitstellungsraum");
        assert_eq!(
            ereignisse[0]["zeitpunkt_at"],
            lade(&app, &admin, e, n).await["eingetroffen_at"]
        );
    }
    // Die Belegung im Raum.
    let (s, verlauf) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/bereitstellungsraeume/{nord}/verlauf"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{verlauf:?}");
    let eintritte: Vec<i64> = verlauf
        .as_array()
        .unwrap()
        .iter()
        .filter(|z| z["art"] == "eintritt")
        .map(|z| z["objekt_id"].as_i64().unwrap())
        .collect();
    assert_eq!(eintritte.len(), 2, "{verlauf:?}");
    assert!(ids.iter().all(|id| eintritte.contains(id)));

    // Der Verweis an der Nachforderung.
    assert_eq!(lade(&app, &admin, e, n).await["einheit_ids"], json!(ids));

    // Genau ein ETB-Eintrag, mit Verweis auf die Nachforderung.
    let nachher = etb(&app, &admin, e).await;
    assert_eq!(nachher.len(), vorher + 1, "{nachher:#?}");
    let eintrag = nachher
        .iter()
        .find(|x| {
            x["inhalt"]
                .as_str()
                .is_some_and(|i| i.contains("als Einheiten übernommen"))
        })
        .expect("Eintrag der Übernahme");
    assert_eq!(
        eintrag["inhalt"],
        "Nachforderung 2× RTW: als Einheiten übernommen (83-1, 83-2), im BR Nord eingetroffen"
    );
    assert_eq!(eintrag["nachforderung_id"], n, "{eintrag:?}");
}

/// Prüfkette (design.md D2): 400 vor 403 vor 404/422/409; nichts wird geschrieben.
#[tokio::test]
async fn pruefkette_der_uebernahme() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let nord = raum(&app, &admin, e, "Nord").await;
    let mit_raum = nachforderung(
        &app,
        &admin,
        e,
        json!({ "ziel_br_id": nord }),
        "eingetroffen",
    )
    .await;
    let ohne_raum = nachforderung(&app, &admin, e, json!({}), "eingetroffen").await;
    let unterwegs = nachforderung(&app, &admin, e, json!({}), "unterwegs").await;
    let andere = einsatz_anlegen_mit(&app, &admin, "Anderer Einsatz").await;
    let fremd = nachforderung(&app, &admin, andere, json!({}), "eingetroffen").await;
    let vorhanden = einheit_bilden(&app, &admin, e, "Florian 83-9").await;

    // 400: die Felder für sich.
    for body in [
        json!({ "nachforderung_id": mit_raum, "einheiten": [] }),
        json!({ "nachforderung_id": mit_raum, "einheiten": [{}] }),
        json!({ "nachforderung_id": mit_raum, "einheiten": [{ "name": "  " }] }),
        json!({ "nachforderung_id": mit_raum, "einheiten": [{ "name": "a", "einheit_id": 1 }] }),
        json!({ "nachforderung_id": "vier", "einheiten": [{ "name": "a" }] }),
    ] {
        let (s, j) = uebernehmen(&app, &admin, e, body.clone()).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{body}: {j:?}");
    }

    // 404, 422, 409 aus der Transaktion.
    for (body, erwartet) in [
        (
            json!({ "nachforderung_id": fremd, "einheiten": [{ "name": "83-1" }] }),
            StatusCode::NOT_FOUND,
        ),
        (
            json!({ "nachforderung_id": unterwegs, "einheiten": [{ "name": "83-1" }] }),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        (
            json!({ "nachforderung_id": mit_raum,
                    "einheiten": [{ "name": "83-1" }, { "name": "83-2" }, { "name": "83-3" }] }),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        (
            json!({ "nachforderung_id": ohne_raum, "einheiten": [{ "name": "83-1" }],
                    "in_bereitstellungsraum": true }),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        (
            // Den Namen gibt es schon im Einsatz (Doppelbuchung, Vergleich ohne Groß/Klein).
            json!({ "nachforderung_id": mit_raum, "einheiten": [{ "name": "florian 83-9" }] }),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        (
            json!({ "nachforderung_id": mit_raum, "einheiten": [{ "einheit_id": 999_999 }] }),
            StatusCode::NOT_FOUND,
        ),
    ] {
        let (s, j) = uebernehmen(&app, &admin, e, body.clone()).await;
        assert_eq!(s, erwartet, "{body}: {j:?}");
    }
    // Nichts geschrieben: nur die vorab gebildete Einheit, keine Verweise.
    let alle = einheiten(&app, &admin, e).await;
    assert_eq!(alle.len(), 1, "{alle:?}");
    assert!(alle[0].get("nachforderung_id").is_none());
    assert_eq!(
        lade(&app, &admin, e, mit_raum).await["einheit_ids"],
        json!([])
    );

    // Verknüpft ist verknüpft: eine zweite Nachforderung bekommt dieselbe Einheit nicht (409).
    let (s, j) = uebernehmen(
        &app,
        &admin,
        e,
        json!({ "nachforderung_id": ohne_raum, "einheiten": [{ "einheit_id": vorhanden }] }),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{j:?}");
    let (s, j) = uebernehmen(
        &app,
        &admin,
        e,
        json!({ "nachforderung_id": mit_raum, "einheiten": [{ "einheit_id": vorhanden }] }),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "{j:?}");

    // 403 vor jedem Lesen: ohne Freigabe der Nachforderungen auch für eine fremde Kennung; mit
    // Buchung ohne Freigabe der Bereitstellungsräume.
    let f = fuehrung(&app, &admin, e, "fuehrung1").await;
    modul_ausblenden(&app, &admin, e, "bereitstellungsraeume").await;
    let (s, j) = uebernehmen(
        &app,
        &f,
        e,
        json!({ "nachforderung_id": mit_raum, "einheiten": [{ "name": "83-1" }],
                "in_bereitstellungsraum": true }),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN, "{j:?}");
    modul_ausblenden(&app, &admin, e, "nachforderungen").await;
    for nid in [mit_raum, 999_999] {
        let (s, j) = uebernehmen(
            &app,
            &f,
            e,
            json!({ "nachforderung_id": nid, "einheiten": [{ "name": "83-1" }] }),
        )
        .await;
        assert_eq!(s, StatusCode::FORBIDDEN, "{nid}: {j:?}");
    }
}

/// D3/D5: eine schon geführte Einheit wird verknüpft; steht sie in einem anderen Raum, bleibt sie
/// dort, und das ETB nennt nur, was gebucht ist. Eine zweite Übernahme ergänzt bis zur Anzahl.
#[tokio::test]
async fn bestehende_einheit_wird_verknuepft_und_bleibt_in_ihrem_raum() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let nord = raum(&app, &admin, e, "Nord").await;
    let sued = raum(&app, &admin, e, "Süd").await;
    let n = nachforderung(
        &app,
        &admin,
        e,
        json!({ "ziel_br_id": nord }),
        "eingetroffen",
    )
    .await;
    let vorab = einheit_bilden(&app, &admin, e, "83-1").await;
    let (s, j) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/bereitstellungsraeume/{sued}/belegung"),
        &admin,
        Some(
            &json!({ "objekt_typ": "einheit", "objekt_id": vorab, "art": "eintritt" }).to_string(),
        ),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{j:?}");

    let (s, j) = uebernehmen(
        &app,
        &admin,
        e,
        json!({ "nachforderung_id": n, "einheiten": [{ "einheit_id": vorab }],
                "in_bereitstellungsraum": true }),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{j:?}");
    assert_eq!(j["einheit_ids"], json!([vorab]));
    let einheit = einheiten(&app, &admin, e)
        .await
        .into_iter()
        .find(|x| x["id"] == vorab)
        .unwrap();
    assert_eq!(einheit["nachforderung_id"], n);
    assert_eq!(einheit["aktueller_br_id"], sued, "bleibt im BR Süd");
    let inhalte: Vec<String> = etb(&app, &admin, e)
        .await
        .iter()
        .filter_map(|x| x["inhalt"].as_str().map(str::to_string))
        .collect();
    assert!(
        inhalte.contains(&"Nachforderung 2× RTW: als Einheit übernommen (83-1)".to_string()),
        "{inhalte:#?}"
    );

    // Die zweite Einheit derselben Nachforderung folgt, eine dritte nicht mehr.
    let (s, j) = uebernehmen(
        &app,
        &admin,
        e,
        json!({ "nachforderung_id": n, "einheiten": [{ "name": "83-2" }],
                "in_bereitstellungsraum": true }),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{j:?}");
    assert_eq!(j["einheit_ids"].as_array().unwrap().len(), 2);
    let (s, j) = uebernehmen(
        &app,
        &admin,
        e,
        json!({ "nachforderung_id": n, "einheiten": [{ "name": "83-3" }] }),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{j:?}");
}

/// D8: solange eine Einheit verknüpft ist, ist die Rücknahme aus „eingetroffen“ gesperrt; eine
/// stornierte Einheit ist gelöscht und gibt sie frei.
#[tokio::test]
async fn ruecknahme_gesperrt_solange_einheiten_verknuepft_sind() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let n = nachforderung(&app, &admin, e, json!({}), "eingetroffen").await;
    let (s, j) = uebernehmen(
        &app,
        &admin,
        e,
        json!({ "nachforderung_id": n, "einheiten": [{ "name": "83-1" }] }),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{j:?}");
    let einheit = j["einheit_ids"][0].as_i64().unwrap();

    let fehler = status(
        &app,
        &admin,
        e,
        n,
        "unterwegs",
        StatusCode::UNPROCESSABLE_ENTITY,
    )
    .await;
    assert!(
        fehler["error"]
            .as_str()
            .is_some_and(|t| t.contains("Einheiten übernommen")),
        "{fehler:?}"
    );
    assert_eq!(lade(&app, &admin, e, n).await["status"], "eingetroffen");

    let (s, j) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/einheiten/{einheit}/stornieren"),
        &admin,
        None,
    )
    .await;
    assert!(s.is_success(), "Stornieren: {s} {j:?}");
    assert_eq!(lade(&app, &admin, e, n).await["einheit_ids"], json!([]));
    status(&app, &admin, e, n, "unterwegs", StatusCode::OK).await;
}

fn storno_url(einsatz: i64, einheit: i64) -> String {
    format!("/api/einsaetze/{einsatz}/einheiten/{einheit}/uebernahme-stornieren")
}

async fn storniere(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    einheit: i64,
) -> (StatusCode, Value) {
    anfrage(app, "POST", &storno_url(einsatz, einheit), cookie, None).await
}

async fn verlauf(app: &axum::Router, cookie: &str, einsatz: i64, br: i64) -> Vec<Value> {
    let (s, j) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/bereitstellungsraeume/{br}/verlauf"),
        cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{j:?}");
    j.as_array().unwrap().clone()
}

/// LLH-1388 (Akzeptanzkriterium): Übernahme mit Ziel BR, dann Storno je Einheit → die Einheit
/// ist aufgelöst, nicht mehr im Raum und nicht mehr verknüpft, ein ETB-Eintrag mit Verweis auf die
/// Nachforderung; erst ohne jede verknüpfte Einheit ist „Eingetroffen“ zurücknehmbar.
#[tokio::test]
async fn fehluebernahme_mit_raum_wird_storniert_und_gibt_die_ruecknahme_frei() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let nord = raum(&app, &admin, e, "Nord").await;
    let n = nachforderung(
        &app,
        &admin,
        e,
        json!({ "ziel_br_id": nord }),
        "eingetroffen",
    )
    .await;
    let (s, j) = uebernehmen(
        &app,
        &admin,
        e,
        json!({ "nachforderung_id": n, "einheiten": [{ "name": "83-1" }, { "name": "83-2" }],
                "in_bereitstellungsraum": true }),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{j:?}");
    let ids: Vec<i64> = j["einheit_ids"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_i64().unwrap())
        .collect();
    let vorher = etb(&app, &admin, e).await.len();

    let (s, antwort) = storniere(&app, &admin, e, ids[0]).await;
    assert_eq!(s, StatusCode::OK, "{antwort:?}");
    assert_eq!(antwort["id"], n, "Antwort ist die Nachforderung");
    assert_eq!(antwort["einheit_ids"], json!([ids[1]]));

    // Nicht mehr aktiv, aufgelöst mit Spur, ohne Verweis und ohne Raum.
    assert!(einheiten(&app, &admin, e)
        .await
        .iter()
        .all(|x| x["id"] != ids[0]));
    let (s, aufgeloest) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/einheiten?aufgeloeste=1"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{aufgeloest:?}");
    let weg = aufgeloest
        .as_array()
        .unwrap()
        .iter()
        .find(|x| x["id"] == ids[0])
        .expect("bleibt als aufgelöst stehen");
    assert!(weg.get("nachforderung_id").is_none(), "{weg:?}");
    assert!(weg["aktueller_br_id"].is_null(), "{weg:?}");
    // Der Raum zeigt den Austritt.
    assert!(verlauf(&app, &admin, e, nord)
        .await
        .iter()
        .any(|z| z["art"] == "austritt" && z["objekt_id"] == ids[0]));

    // Genau ein ETB-Eintrag mit Verweis auf die Nachforderung.
    let nachher = etb(&app, &admin, e).await;
    assert_eq!(nachher.len(), vorher + 1, "{nachher:#?}");
    let eintrag = nachher
        .iter()
        .find(|x| {
            x["inhalt"]
                .as_str()
                .is_some_and(|i| i.contains("Übernahme von 83-1 storniert"))
        })
        .expect("Eintrag des Stornos");
    assert_eq!(
        eintrag["inhalt"],
        "Nachforderung 2× RTW: Übernahme von 83-1 storniert, aus BR Nord ausgetreten, Einheit aufgelöst"
    );
    assert_eq!(eintrag["nachforderung_id"], n, "{eintrag:?}");

    // Noch eine Einheit verknüpft: die Rücknahme bleibt gesperrt.
    status(
        &app,
        &admin,
        e,
        n,
        "unterwegs",
        StatusCode::UNPROCESSABLE_ENTITY,
    )
    .await;
    // Ein zweiter Storno derselben Einheit: sie ist aufgelöst (409).
    let (s, j) = storniere(&app, &admin, e, ids[0]).await;
    assert_eq!(s, StatusCode::CONFLICT, "{j:?}");

    let (s, j) = storniere(&app, &admin, e, ids[1]).await;
    assert_eq!(s, StatusCode::OK, "{j:?}");
    assert_eq!(j["einheit_ids"], json!([]));
    status(&app, &admin, e, n, "unterwegs", StatusCode::OK).await;
}

/// D3 Schritt 4: eine verknüpfte Einheit bleibt im Einsatz; die Buchung der Übernahme wird
/// ausgebucht, ein Ort, den sie schon vorher hatte, bleibt. Ohne Raum wird eine angelegte Einheit
/// gelöscht (keine Spur).
#[tokio::test]
async fn verknuepfte_einheit_bleibt_und_verlaesst_nur_die_gebuchte_buchung() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let nord = raum(&app, &admin, e, "Nord").await;
    let sued = raum(&app, &admin, e, "Süd").await;
    let n = nachforderung(
        &app,
        &admin,
        e,
        json!({ "ziel_br_id": nord }),
        "eingetroffen",
    )
    .await;
    let frei = einheit_bilden(&app, &admin, e, "83-1").await;
    let im_sueden = einheit_bilden(&app, &admin, e, "83-2").await;
    let (s, j) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/bereitstellungsraeume/{sued}/belegung"),
        &admin,
        Some(
            &json!({ "objekt_typ": "einheit", "objekt_id": im_sueden, "art": "eintritt" })
                .to_string(),
        ),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{j:?}");
    let (s, j) = uebernehmen(
        &app,
        &admin,
        e,
        json!({ "nachforderung_id": n,
                "einheiten": [{ "einheit_id": frei }, { "einheit_id": im_sueden }],
                "in_bereitstellungsraum": true }),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{j:?}");

    for id in [frei, im_sueden] {
        let (s, j) = storniere(&app, &admin, e, id).await;
        assert_eq!(s, StatusCode::OK, "{j:?}");
    }
    let alle = einheiten(&app, &admin, e).await;
    let einheit = |id: i64| {
        alle.iter()
            .find(|x| x["id"] == id)
            .expect("bleibt aktiv")
            .clone()
    };
    assert!(einheit(frei).get("nachforderung_id").is_none());
    assert!(
        einheit(frei)["aktueller_br_id"].is_null(),
        "aus BR Nord ausgebucht"
    );
    assert_eq!(
        einheit(im_sueden)["aktueller_br_id"],
        sued,
        "bleibt im BR Süd"
    );
    let inhalte: Vec<String> = etb(&app, &admin, e)
        .await
        .iter()
        .filter_map(|x| x["inhalt"].as_str().map(str::to_string))
        .collect();
    for erwartet in [
        "Nachforderung 2× RTW: Übernahme von 83-1 storniert, aus BR Nord ausgetreten, Verknüpfung gelöst",
        "Nachforderung 2× RTW: Übernahme von 83-2 storniert, Verknüpfung gelöst",
    ] {
        assert!(inhalte.contains(&erwartet.to_string()), "{erwartet}: {inhalte:#?}");
    }
    status(&app, &admin, e, n, "unterwegs", StatusCode::OK).await;

    // Ohne Raum: die angelegte Einheit hat keine Spur und wird gelöscht.
    let ohne = nachforderung(&app, &admin, e, json!({}), "eingetroffen").await;
    let (s, j) = uebernehmen(
        &app,
        &admin,
        e,
        json!({ "nachforderung_id": ohne, "einheiten": [{ "name": "83-5" }] }),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{j:?}");
    let neu = j["einheit_ids"][0].as_i64().unwrap();
    let (s, j) = storniere(&app, &admin, e, neu).await;
    assert_eq!(s, StatusCode::OK, "{j:?}");
    let (_, aufgeloest) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/einheiten?aufgeloeste=1"),
        &admin,
        None,
    )
    .await;
    assert!(aufgeloest
        .as_array()
        .unwrap()
        .iter()
        .all(|x| x["id"] != neu));
    assert!(einheiten(&app, &admin, e)
        .await
        .iter()
        .all(|x| x["id"] != neu));
}

/// D5: Prüffolge des Stornos — 403 ohne Freigabe Nachforderungen vor jedem Lesen, sonst 404
/// (fremd), 422 (ohne Herkunft).
#[tokio::test]
async fn pruefkette_des_stornos() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let andere = einsatz_anlegen_mit(&app, &admin, "Anderer Einsatz").await;
    let ohne_herkunft = einheit_bilden(&app, &admin, e, "Florian 1").await;
    let fremd = einheit_bilden(&app, &admin, andere, "Florian 2").await;
    let n = nachforderung(&app, &admin, e, json!({}), "eingetroffen").await;
    let (s, j) = uebernehmen(
        &app,
        &admin,
        e,
        json!({ "nachforderung_id": n, "einheiten": [{ "name": "83-1" }] }),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{j:?}");
    let uebernommen = j["einheit_ids"][0].as_i64().unwrap();

    let (s, j) = storniere(&app, &admin, e, fremd).await;
    assert_eq!(s, StatusCode::NOT_FOUND, "{j:?}");
    let (s, j) = storniere(&app, &admin, e, ohne_herkunft).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{j:?}");
    assert_eq!(j["error"], "Die Einheit stammt aus keiner Nachforderung");

    let f = fuehrung(&app, &admin, e, "fuehrung2").await;
    modul_ausblenden(&app, &admin, e, "nachforderungen").await;
    for id in [uebernommen, 999_999] {
        let (s, j) = storniere(&app, &f, e, id).await;
        assert_eq!(s, StatusCode::FORBIDDEN, "{id}: {j:?}");
    }
    assert_eq!(
        lade(&app, &admin, e, n).await["einheit_ids"],
        json!([uebernommen])
    );
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

async fn rtw_typ(app: &axum::Router, cookie: &str) -> i64 {
    let (s, typ) = anfrage(
        app,
        "POST",
        "/api/einheit-typen",
        cookie,
        Some(&json!({ "label": "RTW" }).to_string()),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{typ:?}");
    typ["id"].as_i64().unwrap()
}

/// LLH-1448 (Change `o659va5r-nachforderung-herkunft`, design.md D3–D6): ein neuer Eintrag, der
/// einem Fahrzeug ohne Einheit gleicht, führt nicht mehr in die 422. Das Fahrzeug wird zur Einheit
/// vom gewählten Typ, die Besatzung ohne Einheit kommt mit, die Einheit gilt als angelegt (der
/// Storno löst sie auf und gibt Fahrzeug und Besatzung frei); genau ein ETB-Eintrag nennt die
/// Überführung. Zwei gleichnamige Fahrzeuge ohne Einheit bleiben 422.
#[tokio::test]
async fn gleichnamiges_fahrzeug_ohne_einheit_wird_zur_einheit() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let n = nachforderung(&app, &admin, e, json!({}), "eingetroffen").await;
    let typ_id = rtw_typ(&app, &admin).await;
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

    let (s, j) = uebernehmen(
        &app,
        &admin,
        e,
        json!({ "nachforderung_id": n, "einheiten": [{ "name": "rtw 2" }], "typ_id": typ_id }),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "kein 422 mehr: {j:?}");
    let neu = j["einheit_ids"][0].as_i64().unwrap();
    let x = einheiten(&app, &admin, e)
        .await
        .into_iter()
        .find(|x| x["id"] == neu)
        .expect("Einheit");
    assert_eq!(x["name"], "RTW 2", "Name aus dem Fahrzeug");
    assert_eq!(x["funkrufname"], "RTW 2");
    assert_eq!(x["typ_id"], typ_id);
    assert_eq!(x["nachforderung_id"], n);
    assert_eq!(einheit_von(&pool, "einsatz_fahrzeug", ef).await, Some(neu));
    assert_eq!(
        einheit_von(&pool, "einsatz_personal", anna).await,
        Some(neu)
    );
    let angelegt: i64 =
        sqlx::query_scalar("SELECT nachforderung_angelegt FROM einsatz_einheit WHERE id = ?")
            .bind(neu)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(angelegt, 1, "von der Übernahme angelegt");
    let nach = etb(&app, &admin, e).await;
    assert_eq!(nach.len(), vorher + 1, "genau ein ETB-Eintrag: {nach:#?}");
    let eintrag = nach
        .iter()
        .find(|x| {
            x["inhalt"]
                == "Nachforderung 2× RTW: als Einheit übernommen (RTW 2 aus Fahrzeug), Besatzung: Anna"
        })
        .unwrap_or_else(|| panic!("ETB-Eintrag der Übernahme: {nach:#?}"));
    assert_eq!(eintrag["nachforderung_id"], n);

    // Storno: die Einheit wird aufgelöst, Fahrzeug und Besatzung sind wieder frei.
    let (s, j) = storniere(&app, &admin, e, neu).await;
    assert_eq!(s, StatusCode::OK, "{j:?}");
    assert!(einheiten(&app, &admin, e)
        .await
        .iter()
        .all(|x| x["id"] != neu));
    assert_eq!(einheit_von(&pool, "einsatz_fahrzeug", ef).await, None);
    assert_eq!(einheit_von(&pool, "einsatz_personal", anna).await, None);
    assert!(etb(&app, &admin, e)
        .await
        .iter()
        .any(|x| x["inhalt"]
            == "Nachforderung 2× RTW: Übernahme von RTW 2 storniert, Einheit aufgelöst"));

    // Zwei gleichnamige Fahrzeuge ohne Einheit: nicht eindeutig, 422, nichts angelegt.
    adhoc_fahrzeug(&app, &admin, e, "RTW 5").await;
    adhoc_fahrzeug(&app, &admin, e, "RTW 5").await;
    let aktiv = einheiten(&app, &admin, e).await.len();
    let (s, j) = uebernehmen(
        &app,
        &admin,
        e,
        json!({ "nachforderung_id": n, "einheiten": [{ "name": "RTW 5" }] }),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{j:?}");
    assert!(j["error"].as_str().unwrap().contains("RTW 5"), "{j:?}");
    assert_eq!(einheiten(&app, &admin, e).await.len(), aktiv);
}

/// LLH-1448 (design.md D5): steht das gleichnamige Fahrzeug schon in einem Raum, tritt es mit der
/// Notiz „Als Einheit übernommen“ aus, und die Einheit tritt dort zum Zeitpunkt ein, zu dem das
/// Fahrzeug eingetreten war, mit oder ohne Haken „In BR … eintragen“. Die Übernahme hält diesen
/// Eintritt als ihre Buchung fest.
#[tokio::test]
async fn gleichnamiges_fahrzeug_im_raum_macht_der_einheit_platz() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let nord = raum(&app, &admin, e, "Nord").await;
    let n = nachforderung(
        &app,
        &admin,
        e,
        json!({ "ziel_br_id": nord }),
        "eingetroffen",
    )
    .await;

    for (name, haken) in [("RTW 2", true), ("RTW 3", false)] {
        let ef = adhoc_fahrzeug(&app, &admin, e, name).await;
        let (s, j) = anfrage(
            &app,
            "POST",
            &format!("/api/einsaetze/{e}/bereitstellungsraeume/{nord}/belegung"),
            &admin,
            Some(
                &json!({ "objekt_typ": "fahrzeug", "objekt_id": ef, "art": "eintritt" })
                    .to_string(),
            ),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{j:?}");
        let damals = "2026-01-02 10:00:00";
        sqlx::query(
            "UPDATE br_belegung SET zeitpunkt_at = ? WHERE objekt_typ = 'fahrzeug' AND objekt_id = ?",
        )
        .bind(damals)
        .bind(ef)
        .execute(&pool)
        .await
        .unwrap();

        let (s, j) = uebernehmen(
            &app,
            &admin,
            e,
            json!({ "nachforderung_id": n, "einheiten": [{ "name": name }],
                    "in_bereitstellungsraum": haken }),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{name}: {j:?}");
        // Die Antwort ist die Nachforderung: die neue Einheit ist die jüngste ihrer Einheiten.
        let neu = j["einheit_ids"]
            .as_array()
            .unwrap()
            .last()
            .unwrap()
            .as_i64()
            .unwrap();
        let x = einheiten(&app, &admin, e)
            .await
            .into_iter()
            .find(|x| x["id"] == neu)
            .expect("Einheit");
        assert_eq!(
            x["aktueller_br_id"], nord,
            "{name}: die Einheit steht im BR Nord"
        );
        let fahrzeug_br: Option<i64> =
            sqlx::query_scalar("SELECT aktueller_br_id FROM einsatz_fahrzeug WHERE id = ?")
                .bind(ef)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            fahrzeug_br, None,
            "{name}: das Fahrzeug belegt nicht mehr selbst"
        );

        let v = verlauf(&app, &admin, e, nord).await;
        assert!(
            v.iter().any(|z| z["art"] == "austritt"
                && z["objekt_typ"] == "fahrzeug"
                && z["objekt_id"] == ef
                && z["notiz"] == "Als Einheit übernommen"),
            "{name}: Austritt des Fahrzeugs: {v:#?}"
        );
        let (eintritt, zeitpunkt): (i64, String) = sqlx::query_as(
            "SELECT id, zeitpunkt_at FROM br_belegung \
             WHERE objekt_typ = 'einheit' AND objekt_id = ? AND art = 'eintritt'",
        )
        .bind(neu)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            zeitpunkt, damals,
            "{name}: Eintritt zum Zeitpunkt des Fahrzeugs"
        );
        let gebucht: Option<i64> = sqlx::query_scalar(
            "SELECT nachforderung_belegung_id FROM einsatz_einheit WHERE id = ?",
        )
        .bind(neu)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            gebucht,
            Some(eintritt),
            "{name}: die Übernahme hält ihre Buchung"
        );
    }

    // Storno einer überführten Einheit im Raum: sie tritt aus und wird aufgelöst.
    let rtw2 = einheiten(&app, &admin, e)
        .await
        .into_iter()
        .find(|x| x["name"] == "RTW 2")
        .expect("Einheit RTW 2")["id"]
        .as_i64()
        .unwrap();
    let (s, j) = storniere(&app, &admin, e, rtw2).await;
    assert_eq!(s, StatusCode::OK, "{j:?}");
    assert!(verlauf(&app, &admin, e, nord)
        .await
        .iter()
        .any(|z| z["art"] == "austritt" && z["objekt_typ"] == "einheit" && z["objekt_id"] == rtw2));
    assert!(etb(&app, &admin, e).await.iter().any(|x| x["inhalt"]
        == "Nachforderung 2× RTW: Übernahme von RTW 2 storniert, aus BR Nord ausgetreten, \
            Einheit aufgelöst"));
}

/// Review-Fund zu LLH-1448: ein abgerufenes Fahrzeug ohne Einheit wird nicht überführt (409),
/// sonst stünde die Einheit wieder wartend im Raum und der Abruf wäre ohne Kraft. Nach „Abruf
/// aufheben“ gelingt die Überführung, und die Einheit tritt zum Zeitpunkt ein, zu dem das Fahrzeug
/// eingetreten war, nicht zu dem des Abrufs oder seiner Aufhebung.
#[tokio::test]
async fn abgerufenes_fahrzeug_wird_erst_nach_aufheben_ueberfuehrt() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let nord = raum(&app, &admin, e, "Nord").await;
    let n = nachforderung(
        &app,
        &admin,
        e,
        json!({ "ziel_br_id": nord }),
        "eingetroffen",
    )
    .await;
    let ef = adhoc_fahrzeug(&app, &admin, e, "RTW 2").await;
    let belegung = format!("/api/einsaetze/{e}/bereitstellungsraeume/{nord}/belegung");
    let (s, j) = anfrage(
        &app,
        "POST",
        &belegung,
        &admin,
        Some(&json!({ "objekt_typ": "fahrzeug", "objekt_id": ef, "art": "eintritt" }).to_string()),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{j:?}");
    let damals = "2026-01-02 10:00:00";
    sqlx::query(
        "UPDATE br_belegung SET zeitpunkt_at = ? WHERE objekt_typ = 'fahrzeug' AND objekt_id = ?",
    )
    .bind(damals)
    .bind(ef)
    .execute(&pool)
    .await
    .unwrap();
    let abruf = format!("/api/einsaetze/{e}/bereitstellungsraeume/{nord}/abruf");
    let (s, j) = anfrage(
        &app,
        "POST",
        &abruf,
        &admin,
        Some(
            &json!({ "objekt_typ": "fahrzeug", "objekt_id": ef, "auftrag_text": "Pumpen" })
                .to_string(),
        ),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "Abruf: {j:?}");

    let aktiv = einheiten(&app, &admin, e).await.len();
    let body = json!({ "nachforderung_id": n, "einheiten": [{ "name": "RTW 2" }] });
    let (s, j) = uebernehmen(&app, &admin, e, body.clone()).await;
    assert_eq!(s, StatusCode::CONFLICT, "abgerufen: {j:?}");
    assert!(j["error"].as_str().unwrap().contains("abgerufen"), "{j:?}");
    assert_eq!(
        einheiten(&app, &admin, e).await.len(),
        aktiv,
        "nichts angelegt"
    );
    assert_eq!(einheit_von(&pool, "einsatz_fahrzeug", ef).await, None);

    let (s, j) = anfrage(
        &app,
        "POST",
        &format!("{abruf}/aufheben"),
        &admin,
        Some(&json!({ "objekt_typ": "fahrzeug", "objekt_id": ef }).to_string()),
    )
    .await;
    assert!(s.is_success(), "Abruf aufheben: {s} {j:?}");
    let (s, j) = uebernehmen(&app, &admin, e, body).await;
    assert_eq!(s, StatusCode::CREATED, "{j:?}");
    let neu = j["einheit_ids"]
        .as_array()
        .unwrap()
        .last()
        .unwrap()
        .as_i64()
        .unwrap();
    let zeitpunkt: String = sqlx::query_scalar(
        "SELECT zeitpunkt_at FROM br_belegung \
         WHERE objekt_typ = 'einheit' AND objekt_id = ? AND art = 'eintritt'",
    )
    .bind(neu)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        zeitpunkt, damals,
        "Eintrittszeit des Fahrzeugs, nicht die des Abrufs"
    );
}
