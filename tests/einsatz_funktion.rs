//! Funktion des Mitglieds im Einsatz (LFH-615): `EinsatzAnzeige.meine_funktion` für den Kopf
//! und `etb_eintrag.erfasser_funktion` als Snapshot am ETB-Verfasser.
//!
//! Die Ableitungsregel selbst prüfen die Unit-Tests in `src/einsatz/funktion.rs`; hier geht es
//! um die Verdrahtung: beide Einsatz-Pfade, der ETB-Snapshot auf beiden Anlegewegen (mit und
//! ohne `client_id`) und dass eine spätere Umbesetzung einen geschriebenen Eintrag nicht
//! umdeutet.

use axum::http::StatusCode;
use serde_json::Value;

mod common;
use common::*;

fn besetzung_pfad(einsatz: i64, sachgebiet: &str) -> String {
    format!("/api/einsaetze/{einsatz}/stab/besetzung/{sachgebiet}")
}

/// Stamm-Person mit Konto-Kopplung anlegen und in den Einsatz disponieren;
/// liefert die `einsatz_personal.id`.
async fn person_disponieren(
    app: &axum::Router,
    admin: &str,
    einsatz: i64,
    name: &str,
    benutzer_id: i64,
) -> i64 {
    let (status, json) = anfrage(
        app,
        "POST",
        "/api/personal",
        admin,
        Some(&format!(
            r#"{{"name":"{name}","benutzer_id":{benutzer_id}}}"#
        )),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "Person anlegen: {json:?}");
    let person = json["id"].as_i64().unwrap();
    let (status, json) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personal"),
        admin,
        Some(&format!(r#"{{"personal_id":{person}}}"#)),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "disponieren: {json:?}");
    json["id"].as_i64().unwrap()
}

async fn besetzen(app: &axum::Router, admin: &str, einsatz: i64, sachgebiet: &str, ep: i64) {
    let (status, json) = anfrage(
        app,
        "PUT",
        &besetzung_pfad(einsatz, sachgebiet),
        admin,
        Some(&format!(
            r#"{{"besetzung_art":"personal","personal_id":{ep}}}"#
        )),
    )
    .await;
    assert!(
        status.is_success(),
        "besetzen {sachgebiet}: {status} {json:?}"
    );
}

async fn erfassen(app: &axum::Router, cookie: &str, einsatz: i64, body: &str) -> Value {
    let (status, json) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/etb"),
        cookie,
        Some(body),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "ETB erfassen: {json:?}");
    json
}

async fn etb_eintrag(app: &axum::Router, cookie: &str, einsatz: i64, id: i64) -> Value {
    let (status, json) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/etb"),
        cookie,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    json.as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"].as_i64() == Some(id))
        .cloned()
        .expect("Eintrag in der Liste")
}

/// Führungskraft mit Konto, Rolle `fuehrungspersonal`, Person disponiert.
/// Liefert (Einsatz, Cookie der Kraft, einsatz_personal.id).
async fn kraft_im_einsatz(app: &axum::Router, admin: &str) -> (i64, String, i64) {
    let einsatz = einsatz_anlegen(app, admin).await;
    let kraft = benutzer_anlegen(app, admin, "kraft", "fuehrungskraft").await;
    rolle_setzen(app, admin, einsatz, kraft, "fuehrungspersonal").await;
    let ep = person_disponieren(app, admin, einsatz, "Vitt", kraft).await;
    let cookie = login_cookie(app, "kraft", "kraftpw1").await;
    (einsatz, cookie, ep)
}

#[tokio::test]
async fn meine_funktion_in_detail_und_liste() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (einsatz, kraft, ep) = kraft_im_einsatz(&app, &admin).await;

    // Ohne Besetzung und ohne Leitungsrolle: keine Funktion — ABSENT, nicht null.
    let (_, json) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}"),
        &kraft,
        None,
    )
    .await;
    assert!(
        !json.as_object().unwrap().contains_key("meine_funktion"),
        "ohne Funktion fehlt das Feld: {json:?}"
    );

    besetzen(&app, &admin, einsatz, "s2", ep).await;
    let (_, json) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}"),
        &kraft,
        None,
    )
    .await;
    assert_eq!(json["meine_funktion"], "S2 Lage");

    besetzen(&app, &admin, einsatz, "s3", ep).await;
    let (_, json) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}"),
        &kraft,
        None,
    )
    .await;
    assert_eq!(json["meine_funktion"], "S2/S3", "Detail-Pfad");

    // Listen-Pfad baut das Struct-Literal selbst — ein fehlendes Feld dort fiele nur hier auf.
    let (_, liste) = anfrage(&app, "GET", "/api/einsaetze", &kraft, None).await;
    let eintrag = liste
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"].as_i64() == Some(einsatz))
        .unwrap();
    assert_eq!(eintrag["meine_funktion"], "S2/S3", "Listen-Pfad");
}

#[tokio::test]
async fn einsatzleitung_ohne_sachgebiet_heisst_einsatzleitung() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let leitung = benutzer_anlegen(&app, &admin, "leitung", "fuehrungskraft").await;
    rolle_setzen(&app, &admin, einsatz, leitung, "einsatzleitung").await;
    let cookie = login_cookie(&app, "leitung", "leitungpw1").await;

    let (_, json) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}"),
        &cookie,
        None,
    )
    .await;
    assert_eq!(json["meine_funktion"], "Einsatzleitung");

    let e = erfassen(
        &app,
        &cookie,
        einsatz,
        r#"{"typ":"entscheidung","inhalt":"Turnhalle Ost"}"#,
    )
    .await;
    assert_eq!(e["erfasser_funktion"], "EL");
}

#[tokio::test]
async fn etb_snapshot_bleibt_bei_umbesetzung_stehen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (einsatz, kraft, ep) = kraft_im_einsatz(&app, &admin).await;

    // Vor jeder Besetzung: kein Snapshot, und das Feld fehlt statt null zu sein.
    let ohne = erfassen(
        &app,
        &kraft,
        einsatz,
        r#"{"typ":"meldung","inhalt":"vorher"}"#,
    )
    .await;
    assert!(
        !ohne.as_object().unwrap().contains_key("erfasser_funktion"),
        "ohne Funktion fehlt das Feld: {ohne:?}"
    );

    besetzen(&app, &admin, einsatz, "s2", ep).await;
    let s2 = erfassen(
        &app,
        &kraft,
        einsatz,
        r#"{"typ":"lage","inhalt":"Pegel 6,84 m"}"#,
    )
    .await;
    assert_eq!(s2["erfasser_funktion"], "S2");

    // Umbesetzung auf S3: der schon geschriebene Eintrag behält „S2".
    anfrage(&app, "DELETE", &besetzung_pfad(einsatz, "s2"), &admin, None).await;
    besetzen(&app, &admin, einsatz, "s3", ep).await;
    let s3 = erfassen(
        &app,
        &kraft,
        einsatz,
        r#"{"typ":"meldung","inhalt":"nachher"}"#,
    )
    .await;
    assert_eq!(s3["erfasser_funktion"], "S3");

    let alt = etb_eintrag(&app, &kraft, einsatz, s2["id"].as_i64().unwrap()).await;
    assert_eq!(
        alt["erfasser_funktion"], "S2",
        "Snapshot, keine Ableitung beim Lesen"
    );
    let leer = etb_eintrag(&app, &kraft, einsatz, ohne["id"].as_i64().unwrap()).await;
    assert!(!leer.as_object().unwrap().contains_key("erfasser_funktion"));
}

/// Der idempotente Weg (`client_id`, Offline-Queue) hat einen eigenen INSERT — er muss den
/// Snapshot ebenfalls schreiben, und ein Replay liefert den Original-Snapshot.
#[tokio::test]
async fn snapshot_auch_auf_dem_client_id_weg() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (einsatz, kraft, ep) = kraft_im_einsatz(&app, &admin).await;
    besetzen(&app, &admin, einsatz, "s1", ep).await;

    let body = r#"{"typ":"meldung","inhalt":"offline","client_id":"6f1c2a9e-0000-4000-8000-000000000615"}"#;
    let erst = erfassen(&app, &kraft, einsatz, body).await;
    assert_eq!(erst["erfasser_funktion"], "S1");

    anfrage(&app, "DELETE", &besetzung_pfad(einsatz, "s1"), &admin, None).await;
    let (status, replay) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/etb"),
        &kraft,
        Some(body),
    )
    .await;
    assert!(status.is_success(), "Replay: {status} {replay:?}");
    assert_eq!(replay["id"], erst["id"]);
    assert_eq!(
        replay["erfasser_funktion"], "S1",
        "Replay trägt den Original-Snapshot"
    );
}
