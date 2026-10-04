//! Integrationstests des Kommunikationsplans (LFH-848).
//!
//! Spec: `openspec/changes/archive/2026-10-04-lfh-848-kommunikationsplan/specs/stab-kommunikationsplan/spec.md`.
//! Die tragenden Aussagen: eine Funktion je Einsatz höchstens einmal (409), die Verbindung
//! gehört der Stelle, Antwort ist immer der ganze Plan, jede Schreibaktion sendet `stab` und
//! nie `etb`, die Schwärzung nimmt Name und Nummer und lässt das Skelett stehen.

use axum::http::StatusCode;
use serde_json::{json, Value};

mod common;
use common::*;

fn plan_pfad(einsatz: i64) -> String {
    format!("/api/einsaetze/{einsatz}/stab/kommunikationsplan")
}

fn stellen_pfad(einsatz: i64) -> String {
    format!("/api/einsaetze/{einsatz}/stab/kommunikationsplan/stellen")
}

fn stelle_pfad(einsatz: i64, sid: i64) -> String {
    format!("/api/einsaetze/{einsatz}/stab/kommunikationsplan/stellen/{sid}")
}

fn verbindungen_pfad(einsatz: i64, sid: i64) -> String {
    format!("/api/einsaetze/{einsatz}/stab/kommunikationsplan/stellen/{sid}/verbindungen")
}

fn verbindung_pfad(einsatz: i64, vid: i64) -> String {
    format!("/api/einsaetze/{einsatz}/stab/kommunikationsplan/verbindungen/{vid}")
}

async fn laden(app: &axum::Router, cookie: &str, einsatz: i64) -> Value {
    let (status, json) = anfrage(app, "GET", &plan_pfad(einsatz), cookie, None).await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    json
}

async fn stelle_neu(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    body: Value,
) -> (StatusCode, Value) {
    anfrage(
        app,
        "POST",
        &stellen_pfad(einsatz),
        cookie,
        Some(&body.to_string()),
    )
    .await
}

/// Legt eine Stelle an (201 erwartet) und gibt ihre id zurück.
async fn stelle(app: &axum::Router, cookie: &str, einsatz: i64, body: Value) -> i64 {
    let (status, plan) = stelle_neu(app, cookie, einsatz, body.clone()).await;
    assert_eq!(status, StatusCode::CREATED, "{body} → {plan:?}");
    plan.as_array()
        .unwrap()
        .iter()
        .map(|s| s["id"].as_i64().unwrap())
        .max()
        .unwrap()
}

async fn verbindung_neu(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    sid: i64,
    body: Value,
) -> (StatusCode, Value) {
    anfrage(
        app,
        "POST",
        &verbindungen_pfad(einsatz, sid),
        cookie,
        Some(&body.to_string()),
    )
    .await
}

fn stelle_mit_id(plan: &Value, sid: i64) -> &Value {
    plan.as_array()
        .unwrap()
        .iter()
        .find(|s| s["id"] == sid)
        .unwrap_or_else(|| panic!("Stelle {sid} fehlt in {plan:?}"))
}

/// Kennung je Stelle für Reihenfolge-Aussagen: Funktionscode oder Bezeichnung.
fn kennungen(plan: &Value) -> Vec<String> {
    plan.as_array()
        .unwrap()
        .iter()
        .map(|s| {
            s["funktion"]
                .as_str()
                .or(s["bezeichnung"].as_str())
                .unwrap()
                .to_string()
        })
        .collect()
}

// ---------- Lesen und Reihenfolge ----------

#[tokio::test]
async fn neuer_plan_ist_leer() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    assert_eq!(laden(&app, &admin, einsatz).await, json!([]));
}

#[tokio::test]
async fn reihenfolge_katalog_dann_extern_nach_art() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    // Absichtlich durcheinander angelegt.
    stelle(
        &app,
        &admin,
        einsatz,
        json!({"stellenart":"behoerde","bezeichnung":"Polizei PI Nord"}),
    )
    .await;
    stelle(
        &app,
        &admin,
        einsatz,
        json!({"stellenart":"funktion","funktion":"fachberater","bezeichnung":"THW"}),
    )
    .await;
    stelle(
        &app,
        &admin,
        einsatz,
        json!({"stellenart":"funktion","funktion":"s4"}),
    )
    .await;
    stelle(
        &app,
        &admin,
        einsatz,
        json!({"stellenart":"leitstelle","bezeichnung":"ILS Nord"}),
    )
    .await;
    stelle(
        &app,
        &admin,
        einsatz,
        json!({"stellenart":"funktion","funktion":"el"}),
    )
    .await;
    stelle(
        &app,
        &admin,
        einsatz,
        json!({"stellenart":"behoerde","bezeichnung":"Ordnungsamt"}),
    )
    .await;

    let plan = laden(&app, &admin, einsatz).await;
    assert_eq!(
        kennungen(&plan),
        [
            "el",
            "s4",
            "fachberater",
            "ILS Nord",
            "Polizei PI Nord",
            "Ordnungsamt"
        ],
        "Funktionen in Katalogfolge, dann Leitstelle vor Behörde, Behörden in Anlagefolge"
    );
}

#[tokio::test]
async fn funktion_label_traegt_das_mandantenlabel() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (status, _) = anfrage(
        &app,
        "PUT",
        "/api/org-fuehrungsfunktionen/s4",
        &admin,
        Some(r#"{"label":"Versorgung (Logistik)"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let sid = stelle(
        &app,
        &admin,
        einsatz,
        json!({"stellenart":"funktion","funktion":"s4"}),
    )
    .await;

    let plan = laden(&app, &admin, einsatz).await;
    let s = stelle_mit_id(&plan, sid);
    assert_eq!(s["funktion_label"], "S4 Versorgung (Logistik)");
    assert!(
        !s.as_object().unwrap().contains_key("bezeichnung"),
        "ohne Bezeichnung fehlt das Feld: {s:?}"
    );
}

// ---------- Stellen anlegen ----------

#[tokio::test]
async fn doppelte_funktion_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    stelle(
        &app,
        &admin,
        einsatz,
        json!({"stellenart":"funktion","funktion":"s3"}),
    )
    .await;

    let (status, _) = stelle_neu(
        &app,
        &admin,
        einsatz,
        json!({"stellenart":"funktion","funktion":"s3"}),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(
        laden(&app, &admin, einsatz).await.as_array().unwrap().len(),
        1
    );

    // Fachberater mehrfach, aber je Bezeichnung einmal (ohne Groß-/Kleinschreibung).
    stelle(
        &app,
        &admin,
        einsatz,
        json!({"stellenart":"funktion","funktion":"fachberater","bezeichnung":"THW"}),
    )
    .await;
    stelle(
        &app,
        &admin,
        einsatz,
        json!({"stellenart":"funktion","funktion":"fachberater","bezeichnung":"Chemie"}),
    )
    .await;
    let (status, _) = stelle_neu(
        &app,
        &admin,
        einsatz,
        json!({"stellenart":"funktion","funktion":"fachberater","bezeichnung":"thw"}),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
}

#[tokio::test]
async fn statuscodes_beim_anlegen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let lang = "x".repeat(201);

    for (body, erwartet) in [
        (
            json!({"stellenart":"funktion","funktion":"s9"}),
            StatusCode::BAD_REQUEST,
        ),
        (json!({"stellenart":"funktion"}), StatusCode::BAD_REQUEST),
        (
            json!({"stellenart":"feuerwehrhaus","bezeichnung":"x"}),
            StatusCode::BAD_REQUEST,
        ),
        (
            json!({"stellenart":"funktion","funktion":"fachberater"}),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        (
            json!({"stellenart":"funktion","funktion":"s3","bezeichnung":"Müller"}),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        (
            json!({"stellenart":"funktion","funktion":"s7"}),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        (
            json!({"stellenart":"leitstelle","bezeichnung":"   "}),
            StatusCode::BAD_REQUEST,
        ),
        (json!({"stellenart":"leitstelle"}), StatusCode::BAD_REQUEST),
        (
            json!({"stellenart":"leitstelle","bezeichnung":lang}),
            StatusCode::BAD_REQUEST,
        ),
        (
            json!({"stellenart":"leitstelle","bezeichnung":"ILS","funktion":"s2"}),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
    ] {
        let (status, json) = stelle_neu(&app, &admin, einsatz, body.clone()).await;
        assert_eq!(status, erwartet, "{body} → {json:?}");
    }
    assert_eq!(
        laden(&app, &admin, einsatz).await,
        json!([]),
        "nichts gespeichert"
    );

    // S7 eingeschaltet → angenommen.
    anfrage(
        &app,
        "PUT",
        "/api/org-fuehrungsfunktionen/s7",
        &admin,
        Some(r#"{"aktiv":true}"#),
    )
    .await;
    let (status, json) = stelle_neu(
        &app,
        &admin,
        einsatz,
        json!({"stellenart":"funktion","funktion":"s7"}),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{json:?}");
}

// ---------- Stellen ändern und entfernen ----------

#[tokio::test]
async fn umbenennen_aendert_nur_die_bezeichnung() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let sid = stelle(
        &app,
        &admin,
        einsatz,
        json!({"stellenart":"behoerde","bezeichnung":"Polizei"}),
    )
    .await;

    let (status, plan) = anfrage(
        &app,
        "PATCH",
        &stelle_pfad(einsatz, sid),
        &admin,
        Some(r#"{"bezeichnung":" Polizei PI Nord "}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{plan:?}");
    assert_eq!(stelle_mit_id(&plan, sid)["bezeichnung"], "Polizei PI Nord");

    // Stellenart ist nach dem Anlegen fest: ein Body mit ihr scheitert, statt still zu wirken.
    let (status, _) = anfrage(
        &app,
        "PATCH",
        &stelle_pfad(einsatz, sid),
        &admin,
        Some(r#"{"stellenart":"leitstelle","bezeichnung":"ILS"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let plan = laden(&app, &admin, einsatz).await;
    assert_eq!(stelle_mit_id(&plan, sid)["stellenart"], "behoerde");

    // Leer bei externer Stelle → 400; Bezeichnung an einem Sachgebiet → 422.
    let (status, _) = anfrage(
        &app,
        "PATCH",
        &stelle_pfad(einsatz, sid),
        &admin,
        Some(r#"{"bezeichnung":""}"#),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let s2 = stelle(
        &app,
        &admin,
        einsatz,
        json!({"stellenart":"funktion","funktion":"s2"}),
    )
    .await;
    let (status, _) = anfrage(
        &app,
        "PATCH",
        &stelle_pfad(einsatz, s2),
        &admin,
        Some(r#"{"bezeichnung":"Müller"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn entfernen_nimmt_die_verbindungen_mit() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let sid = stelle(
        &app,
        &admin,
        einsatz,
        json!({"stellenart":"behoerde","bezeichnung":"Polizei"}),
    )
    .await;
    verbindung_neu(
        &app,
        &admin,
        einsatz,
        sid,
        json!({"mittel":"festnetz","wert":"110"}),
    )
    .await;
    verbindung_neu(
        &app,
        &admin,
        einsatz,
        sid,
        json!({"mittel":"fax","wert":"0421 9"}),
    )
    .await;

    let (status, plan) = anfrage(&app, "DELETE", &stelle_pfad(einsatz, sid), &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(plan, json!([]));
    let rest: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM einsatz_kommunikation_verbindung WHERE einsatz_id = ?",
    )
    .bind(einsatz)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(rest, 0, "CASCADE nimmt die Verbindungen mit");
}

// ---------- Verbindungen ----------

#[tokio::test]
async fn verbindungen_in_anlagefolge_mit_hinweis() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let sid = stelle(
        &app,
        &admin,
        einsatz,
        json!({"stellenart":"leitstelle","bezeichnung":"ILS Nord"}),
    )
    .await;

    let (status, _) = verbindung_neu(
        &app,
        &admin,
        einsatz,
        sid,
        json!({"mittel":"festnetz","wert":" 0421 1234 ","hinweis":"Lagedienst"}),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let (status, plan) = verbindung_neu(
        &app,
        &admin,
        einsatz,
        sid,
        json!({"mittel":"fax","wert":"0421 1235"}),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    let v = stelle_mit_id(&plan, sid)["verbindungen"]
        .as_array()
        .unwrap()
        .clone();
    assert_eq!(v.len(), 2);
    assert_eq!(v[0]["mittel"], "festnetz");
    assert_eq!(v[0]["wert"], "0421 1234", "getrimmt");
    assert_eq!(v[0]["hinweis"], "Lagedienst");
    assert_eq!(v[1]["mittel"], "fax");
    assert!(!v[1].as_object().unwrap().contains_key("hinweis"));
}

#[tokio::test]
async fn statuscodes_der_verbindung() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let sid = stelle(
        &app,
        &admin,
        einsatz,
        json!({"stellenart":"leitstelle","bezeichnung":"ILS"}),
    )
    .await;
    let lang = "1".repeat(201);

    for (body, erwartet) in [
        (
            json!({"mittel":"brieftaube","wert":"x"}),
            StatusCode::BAD_REQUEST,
        ),
        (
            json!({"mittel":"mobil","wert":"  "}),
            StatusCode::BAD_REQUEST,
        ),
        (json!({"mittel":"mobil"}), StatusCode::BAD_REQUEST),
        (
            json!({"mittel":"mobil","wert":lang}),
            StatusCode::BAD_REQUEST,
        ),
    ] {
        let (status, json) = verbindung_neu(&app, &admin, einsatz, sid, body.clone()).await;
        assert_eq!(status, erwartet, "{body} → {json:?}");
    }
    let (status, _) = verbindung_neu(
        &app,
        &admin,
        einsatz,
        999_999,
        json!({"mittel":"mobil","wert":"1"}),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let plan = laden(&app, &admin, einsatz).await;
    assert_eq!(stelle_mit_id(&plan, sid)["verbindungen"], json!([]));
}

#[tokio::test]
async fn verbindung_aendern_und_entfernen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let sid = stelle(
        &app,
        &admin,
        einsatz,
        json!({"stellenart":"funktion","funktion":"s2"}),
    )
    .await;
    let (_, plan) = verbindung_neu(
        &app,
        &admin,
        einsatz,
        sid,
        json!({"mittel":"mobil","wert":"0170 111","hinweis":"Diensthandy"}),
    )
    .await;
    let vid = stelle_mit_id(&plan, sid)["verbindungen"][0]["id"]
        .as_i64()
        .unwrap();

    // Nur der Wert: Mittel und Hinweis bleiben.
    let (status, plan) = anfrage(
        &app,
        "PATCH",
        &verbindung_pfad(einsatz, vid),
        &admin,
        Some(r#"{"wert":"0170 222"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{plan:?}");
    let v = &stelle_mit_id(&plan, sid)["verbindungen"][0];
    assert_eq!(
        (
            v["mittel"].as_str(),
            v["wert"].as_str(),
            v["hinweis"].as_str()
        ),
        (Some("mobil"), Some("0170 222"), Some("Diensthandy"))
    );

    // null löscht den Hinweis.
    let (_, plan) = anfrage(
        &app,
        "PATCH",
        &verbindung_pfad(einsatz, vid),
        &admin,
        Some(r#"{"hinweis":null}"#),
    )
    .await;
    assert!(!stelle_mit_id(&plan, sid)["verbindungen"][0]
        .as_object()
        .unwrap()
        .contains_key("hinweis"));

    // Leerer Body, unbekanntes Mittel → 400.
    let (status, _) = anfrage(
        &app,
        "PATCH",
        &verbindung_pfad(einsatz, vid),
        &admin,
        Some("{}"),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = anfrage(
        &app,
        "PATCH",
        &verbindung_pfad(einsatz, vid),
        &admin,
        Some(r#"{"mittel":"funk"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    let (status, plan) =
        anfrage(&app, "DELETE", &verbindung_pfad(einsatz, vid), &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(stelle_mit_id(&plan, sid)["verbindungen"], json!([]));
    let (status, _) = anfrage(&app, "DELETE", &verbindung_pfad(einsatz, vid), &admin, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

/// Eine Stelle oder Verbindung eines anderen Einsatzes ist über diesen Einsatz nicht erreichbar.
#[tokio::test]
async fn fremde_ids_sind_404() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let a = einsatz_anlegen_mit(&app, &admin, "Einsatz A").await;
    let b = einsatz_anlegen_mit(&app, &admin, "Einsatz B").await;
    let sid = stelle(
        &app,
        &admin,
        a,
        json!({"stellenart":"leitstelle","bezeichnung":"ILS"}),
    )
    .await;
    let (_, plan) =
        verbindung_neu(&app, &admin, a, sid, json!({"mittel":"mobil","wert":"1"})).await;
    let vid = stelle_mit_id(&plan, sid)["verbindungen"][0]["id"]
        .as_i64()
        .unwrap();

    for (methode, pfad, body) in [
        ("PATCH", stelle_pfad(b, sid), Some(r#"{"bezeichnung":"x"}"#)),
        ("DELETE", stelle_pfad(b, sid), None),
        (
            "POST",
            verbindungen_pfad(b, sid),
            Some(r#"{"mittel":"mobil","wert":"2"}"#),
        ),
        ("PATCH", verbindung_pfad(b, vid), Some(r#"{"wert":"2"}"#)),
        ("DELETE", verbindung_pfad(b, vid), None),
    ] {
        let (status, json) = anfrage(&app, methode, &pfad, &admin, body).await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{methode} {pfad} → {json:?}");
    }
    let plan = laden(&app, &admin, a).await;
    assert_eq!(stelle_mit_id(&plan, sid)["verbindungen"][0]["wert"], "1");
}

// ---------- Live ----------

#[tokio::test]
async fn jede_schreibaktion_sendet_stab_und_nie_etb() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let vor = system_etb_anzahl(&app, &admin, einsatz).await;

    let zaehle = |rx: &mut tokio::sync::broadcast::Receiver<_>| {
        let (mut stab, mut etb) = (0, 0);
        while let Ok(n) = rx.try_recv() {
            let n: lifeline_hub::live::LiveNachricht = n;
            match n.event.as_str() {
                "stab" => stab += 1,
                "etb" => etb += 1,
                _ => {}
            }
        }
        (stab, etb)
    };

    let mut rx = live.abonniere(einsatz);
    let sid = stelle(
        &app,
        &admin,
        einsatz,
        json!({"stellenart":"leitstelle","bezeichnung":"ILS"}),
    )
    .await;
    let (_, plan) = verbindung_neu(
        &app,
        &admin,
        einsatz,
        sid,
        json!({"mittel":"mobil","wert":"1"}),
    )
    .await;
    let vid = stelle_mit_id(&plan, sid)["verbindungen"][0]["id"]
        .as_i64()
        .unwrap();
    anfrage(
        &app,
        "PATCH",
        &verbindung_pfad(einsatz, vid),
        &admin,
        Some(r#"{"wert":"2"}"#),
    )
    .await;
    anfrage(
        &app,
        "PATCH",
        &stelle_pfad(einsatz, sid),
        &admin,
        Some(r#"{"bezeichnung":"ILS Nord"}"#),
    )
    .await;
    anfrage(&app, "DELETE", &verbindung_pfad(einsatz, vid), &admin, None).await;
    anfrage(&app, "DELETE", &stelle_pfad(einsatz, sid), &admin, None).await;
    assert_eq!(
        zaehle(&mut rx),
        (6, 0),
        "sechs Schreibaktionen, sechs Stab-Ereignisse, kein ETB"
    );
    assert_eq!(
        system_etb_anzahl(&app, &admin, einsatz).await,
        vor,
        "kein ETB-Eintrag"
    );

    // Eine abgelehnte Aktion sendet nichts.
    let mut rx = live.abonniere(einsatz);
    stelle_neu(
        &app,
        &admin,
        einsatz,
        json!({"stellenart":"funktion","funktion":"s9"}),
    )
    .await;
    assert_eq!(zaehle(&mut rx), (0, 0));
}

// ---------- Rechte und Lebenszyklus ----------

#[tokio::test]
async fn beobachter_liest_aber_schreibt_nicht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let sid = stelle(
        &app,
        &admin,
        einsatz,
        json!({"stellenart":"leitstelle","bezeichnung":"ILS"}),
    )
    .await;
    let beob = benutzer_anlegen(&app, &admin, "beobachter", "keine").await;
    rolle_setzen(&app, &admin, einsatz, beob, "beobachter").await;
    let beob_cookie = login_cookie(&app, "beobachter", "beobachterpw1").await;

    assert_eq!(
        laden(&app, &beob_cookie, einsatz)
            .await
            .as_array()
            .unwrap()
            .len(),
        1
    );
    for (methode, pfad, body) in [
        (
            "POST",
            stellen_pfad(einsatz),
            Some(r#"{"stellenart":"behoerde","bezeichnung":"x"}"#),
        ),
        (
            "PATCH",
            stelle_pfad(einsatz, sid),
            Some(r#"{"bezeichnung":"x"}"#),
        ),
        ("DELETE", stelle_pfad(einsatz, sid), None),
        (
            "POST",
            verbindungen_pfad(einsatz, sid),
            Some(r#"{"mittel":"mobil","wert":"1"}"#),
        ),
    ] {
        let (status, _) = anfrage(&app, methode, &pfad, &beob_cookie, body).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{methode} {pfad}");
    }
    assert_eq!(
        laden(&app, &admin, einsatz).await.as_array().unwrap().len(),
        1
    );
}

#[tokio::test]
async fn fremde_org_wird_abgewiesen() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    fremde_org_anlegen(&pool, "Fremd-Orga", "fremd", "fremdpw1", "fuehrungskraft").await;
    let fremd = login_cookie(&app, "fremd", "fremdpw1").await;

    for (methode, pfad, body) in [
        ("GET", plan_pfad(einsatz), None),
        (
            "POST",
            stellen_pfad(einsatz),
            Some(r#"{"stellenart":"behoerde","bezeichnung":"x"}"#),
        ),
    ] {
        let (status, _) = anfrage(&app, methode, &pfad, &fremd, body).await;
        assert!(
            status == StatusCode::FORBIDDEN || status == StatusCode::NOT_FOUND,
            "{methode} {pfad}: erwartet 403/404, war {status}"
        );
    }
}

#[tokio::test]
async fn abgeschlossener_einsatz_ist_409_und_bleibt_lesbar() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    stelle(
        &app,
        &admin,
        einsatz,
        json!({"stellenart":"leitstelle","bezeichnung":"ILS"}),
    )
    .await;
    anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschliessen"),
        &admin,
        None,
    )
    .await;

    let (status, _) = stelle_neu(
        &app,
        &admin,
        einsatz,
        json!({"stellenart":"behoerde","bezeichnung":"x"}),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(
        laden(&app, &admin, einsatz).await.as_array().unwrap().len(),
        1
    );
}

// ---------- Schwärzung ----------

#[tokio::test]
async fn schwaerzung_nimmt_name_und_nummer_und_behaelt_das_skelett() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let sid = stelle(
        &app,
        &admin,
        einsatz,
        json!({"stellenart":"verbindungsperson","bezeichnung":"Herr Beispiel, Stadtverwaltung"}),
    )
    .await;
    verbindung_neu(
        &app,
        &admin,
        einsatz,
        sid,
        json!({"mittel":"mobil","wert":"0170 999","hinweis":"privat, nur Notfall"}),
    )
    .await;

    let mut tx = pool.begin().await.unwrap();
    lifeline_hub::einsatz::schwaerzung_registry::scrubbe_aus_registry(
        &mut tx,
        einsatz,
        lifeline_hub::einsatz::schwaerzung_registry::Umfang::Alles,
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();

    let (art, bezeichnung): (String, Option<String>) = sqlx::query_as(
        "SELECT stellenart, bezeichnung FROM einsatz_kommunikation_stelle WHERE id = ?",
    )
    .bind(sid)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(art, "verbindungsperson");
    assert_eq!(bezeichnung, None);

    let (mittel, wert, hinweis): (String, String, Option<String>) = sqlx::query_as(
        "SELECT mittel, wert, hinweis FROM einsatz_kommunikation_verbindung WHERE stelle_id = ?",
    )
    .bind(sid)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(mittel, "mobil");
    assert!(!wert.contains("0170"), "Nummer geschwärzt: {wert}");
    assert_eq!(hinweis, None);
}
