//! Funktion des Mitglieds im Einsatz (LFH-615): `EinsatzAnzeige.meine_funktion` für den Kopf
//! und `etb_eintrag.erfasser_funktion` als Snapshot am ETB-Verfasser.
//!
//! Quelle ist allein die Führungsfunktion der Mitgliedschaft (i6k6mzed, design.md D2). Die
//! Ableitungsregel selbst prüfen die Unit-Tests in `src/einsatz/funktion.rs`; hier geht es um die
//! Verdrahtung: beide Einsatz-Pfade, der ETB-Snapshot auf beiden Anlegewegen (mit und ohne
//! `client_id`) und dass ein späterer Funktionswechsel einen geschriebenen Eintrag nicht umdeutet.

use axum::http::StatusCode;
use serde_json::Value;

mod common;
use common::*;

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

async fn kopf(app: &axum::Router, cookie: &str, einsatz: i64) -> Value {
    let (status, json) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}"),
        cookie,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    json
}

/// Führungskraft mit Konto und Rolle `fuehrungspersonal`, ohne Funktion.
/// Liefert (Einsatz, Cookie der Kraft, Benutzer-ID).
async fn kraft_im_einsatz(app: &axum::Router, admin: &str) -> (i64, String, i64) {
    let einsatz = einsatz_anlegen(app, admin).await;
    let kraft = benutzer_anlegen(app, admin, "kraft", "fuehrungskraft").await;
    rolle_setzen(app, admin, einsatz, kraft, "fuehrungspersonal").await;
    let cookie = login_cookie(app, "kraft", "kraftpw1").await;
    (einsatz, cookie, kraft)
}

#[tokio::test]
async fn meine_funktion_in_detail_und_liste() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (einsatz, kraft, id) = kraft_im_einsatz(&app, &admin).await;

    // Ohne Funktion und ohne Leitungsrolle: keine Funktion — ABSENT, nicht null.
    let json = kopf(&app, &kraft, einsatz).await;
    assert!(
        !json.as_object().unwrap().contains_key("meine_funktion"),
        "ohne Funktion fehlt das Feld: {json:?}"
    );
    for feld in ["meine_funktion_code", "meine_funktion_bezeichnung"] {
        assert!(
            !json.as_object().unwrap().contains_key(feld),
            "ohne Funktion fehlt {feld}: {json:?}"
        );
    }
    assert_eq!(json["meine_sachgebiete"], serde_json::json!([]));

    funktion_setzen(&app, &admin, einsatz, id, "fuehrungspersonal", Some("s2")).await;
    let json = kopf(&app, &kraft, einsatz).await;
    assert_eq!(json["meine_funktion"], "S2 Lage", "Detail-Pfad");
    assert_eq!(json["meine_funktion_code"], "s2", "Detail-Pfad");
    assert!(
        !json
            .as_object()
            .unwrap()
            .contains_key("meine_funktion_bezeichnung"),
        "ein Sachgebiet trägt keine Bezeichnung: {json:?}"
    );
    assert_eq!(json["meine_sachgebiete"], serde_json::json!(["s2"]));

    // Listen-Pfad baut das Struct-Literal selbst — ein fehlendes Feld dort fiele nur hier auf.
    let (_, liste) = anfrage(&app, "GET", "/api/einsaetze", &kraft, None).await;
    let eintrag = liste
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"].as_i64() == Some(einsatz))
        .unwrap();
    assert_eq!(eintrag["meine_funktion"], "S2 Lage", "Listen-Pfad");
    assert_eq!(eintrag["meine_funktion_code"], "s2", "Listen-Pfad");
    assert_eq!(eintrag["meine_sachgebiete"], serde_json::json!(["s2"]));
}

/// Listen-Pfad (`GET /api/einsaetze`) mit ZWEI Einsätzen, in denen derselbe Benutzer
/// verschiedene Funktionen trägt. **Nur diese Hälfte** fängt einen stillen Platzhalter im
/// Struct-Literal von `liste_fuer` (vorher in `tests/stab.rs`, LFH-46).
#[tokio::test]
async fn meine_sachgebiete_im_listen_pfad_ueber_zwei_einsaetze() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let kraft = benutzer_anlegen(&app, &admin, "kraft", "fuehrungskraft").await;
    let mut erwartet = std::collections::HashMap::new();
    for sg in ["s1", "s4"] {
        let einsatz = einsatz_anlegen(&app, &admin).await;
        funktion_setzen(&app, &admin, einsatz, kraft, "fuehrungspersonal", Some(sg)).await;
        erwartet.insert(einsatz, sg);
    }
    let cookie = login_cookie(&app, "kraft", "kraftpw1").await;
    let (status, json) = anfrage(&app, "GET", "/api/einsaetze", &cookie, None).await;
    assert_eq!(status, StatusCode::OK);
    let liste = json.as_array().unwrap();
    assert_eq!(liste.len(), 2, "beide Einsätze sind lesbar");
    for eintrag in liste {
        let id = eintrag["id"].as_i64().unwrap();
        let soll = erwartet.get(&id).expect("unerwarteter Einsatz");
        assert_eq!(
            eintrag["meine_sachgebiete"],
            serde_json::json!([soll]),
            "Einsatz {id}: der Listen-Pfad muss dieselben Sachgebiete liefern wie der Detail-Pfad"
        );
    }
}

/// Spec `einsatzkopf-live`, „Höchstens ein Sachgebiet“: ein Fachberater hat kein Sachgebiet,
/// seine Funktion nennt das Label mit der Bezeichnung (i6k6mzed, design.md D2). Der ETB-Snapshot
/// trägt nur das Label, nie die Bezeichnung: sie wird geschwärzt.
#[tokio::test]
async fn fachberater_hat_kein_sachgebiet() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (einsatz, kraft, id) = kraft_im_einsatz(&app, &admin).await;
    let (status, json) = anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/mitglieder/{id}"),
        &admin,
        Some(r#"{"einsatz_rolle":"fuehrungspersonal","fuehrungsfunktion":"fachberater","fuehrungsstelle":"THW"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json:?}");

    let json = kopf(&app, &kraft, einsatz).await;
    assert_eq!(json["meine_funktion"], "Fachberater: THW");
    assert_eq!(json["meine_sachgebiete"], serde_json::json!([]));
    // Code und Bezeichnung für „meine Stelle“ (pkjvl5iy, design.md D1), in Detail und Liste.
    assert_eq!(json["meine_funktion_code"], "fachberater");
    assert_eq!(json["meine_funktion_bezeichnung"], "THW");
    let (_, liste) = anfrage(&app, "GET", "/api/einsaetze", &kraft, None).await;
    let eintrag = liste
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"].as_i64() == Some(einsatz))
        .unwrap();
    assert_eq!(eintrag["meine_funktion_code"], "fachberater", "Listen-Pfad");
    assert_eq!(eintrag["meine_funktion_bezeichnung"], "THW", "Listen-Pfad");

    let e = erfassen(
        &app,
        &kraft,
        einsatz,
        r#"{"von":"ELW 1","an":"ELW 1","typ":"meldung","inhalt":"Statik geprüft"}"#,
    )
    .await;
    assert_eq!(e["erfasser_funktion"], "Fachberater");
}

#[tokio::test]
async fn einsatzleitung_ohne_funktion_heisst_einsatzleitung() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let leitung = benutzer_anlegen(&app, &admin, "leitung", "fuehrungskraft").await;
    rolle_setzen(&app, &admin, einsatz, leitung, "einsatzleitung").await;
    let cookie = login_cookie(&app, "leitung", "leitungpw1").await;

    let json = kopf(&app, &cookie, einsatz).await;
    assert_eq!(json["meine_funktion"], "Einsatzleitung");
    assert_eq!(json["meine_funktion_code"], "el");

    let e = erfassen(
        &app,
        &cookie,
        einsatz,
        r#"{"von":"ELW 1","an":"ELW 1","typ":"entscheidung","inhalt":"Turnhalle Ost"}"#,
    )
    .await;
    assert_eq!(e["erfasser_funktion"], "EL");

    // Die Funktion der Mitgliedschaft gewinnt gegen die Rolle.
    funktion_setzen(&app, &admin, einsatz, leitung, "einsatzleitung", Some("s3")).await;
    let json = kopf(&app, &cookie, einsatz).await;
    assert_eq!(json["meine_funktion"], "S3 Einsatz");
    assert_eq!(json["meine_funktion_code"], "s3");
}

/// Spec `einsatzkopf-live`, „Funktion ohne Sachgebiet“ (pkjvl5iy): S7 hat kein Sachgebiet, der
/// Code steht trotzdem im Kopf — sonst erkennt „meine Stelle“ die Person nicht (LLH-1606).
#[tokio::test]
async fn s7_traegt_code_ohne_sachgebiet() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (status, _) = anfrage(
        &app,
        "PUT",
        "/api/org-fuehrungsfunktionen/s7",
        &admin,
        Some(r#"{"aktiv":true}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "S7 einschalten");
    let (einsatz, kraft, id) = kraft_im_einsatz(&app, &admin).await;
    funktion_setzen(&app, &admin, einsatz, id, "fuehrungspersonal", Some("s7")).await;

    let json = kopf(&app, &kraft, einsatz).await;
    assert_eq!(json["meine_sachgebiete"], serde_json::json!([]));
    assert_eq!(json["meine_funktion_code"], "s7");
    assert!(
        !json
            .as_object()
            .unwrap()
            .contains_key("meine_funktion_bezeichnung"),
        "S7 trägt keine Bezeichnung: {json:?}"
    );
}

#[tokio::test]
async fn etb_snapshot_bleibt_beim_funktionswechsel_stehen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (einsatz, kraft, id) = kraft_im_einsatz(&app, &admin).await;

    // Ohne Funktion: kein Snapshot, und das Feld fehlt statt null zu sein.
    let ohne = erfassen(
        &app,
        &kraft,
        einsatz,
        r#"{"von":"ELW 1","an":"ELW 1","typ":"meldung","inhalt":"vorher"}"#,
    )
    .await;
    assert!(
        !ohne.as_object().unwrap().contains_key("erfasser_funktion"),
        "ohne Funktion fehlt das Feld: {ohne:?}"
    );

    funktion_setzen(&app, &admin, einsatz, id, "fuehrungspersonal", Some("s2")).await;
    let s2 = erfassen(
        &app,
        &kraft,
        einsatz,
        r#"{"von":"ELW 1","an":"ELW 1","typ":"lage","inhalt":"Pegel 6,84 m"}"#,
    )
    .await;
    assert_eq!(s2["erfasser_funktion"], "S2");

    // Wechsel auf S3: der schon geschriebene Eintrag behält „S2".
    funktion_setzen(&app, &admin, einsatz, id, "fuehrungspersonal", Some("s3")).await;
    let s3 = erfassen(
        &app,
        &kraft,
        einsatz,
        r#"{"von":"ELW 1","an":"ELW 1","typ":"meldung","inhalt":"nachher"}"#,
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
    let (einsatz, kraft, id) = kraft_im_einsatz(&app, &admin).await;
    funktion_setzen(&app, &admin, einsatz, id, "fuehrungspersonal", Some("s1")).await;

    let body = r#"{"von":"ELW 1","an":"ELW 1","typ":"meldung","inhalt":"offline","client_id":"6f1c2a9e-0000-4000-8000-000000000615"}"#;
    let erst = erfassen(&app, &kraft, einsatz, body).await;
    assert_eq!(erst["erfasser_funktion"], "S1");

    funktion_setzen(&app, &admin, einsatz, id, "fuehrungspersonal", None).await;
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
