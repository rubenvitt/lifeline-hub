//! Integrationstests des Informationstelefons S5 (LFH-554) unter
//! `/api/einsaetze/{id}/stab/infotelefon`: Statuscodes, Rechte, Lebenszyklus, Live. Die
//! Fachlogik prüft `src/infotelefon/repo/tests.rs`.

use axum::http::StatusCode;
use serde_json::Value;
use std::time::Duration;

mod common;
use common::*;

fn pfad(e: i64) -> String {
    format!("/api/einsaetze/{e}/stab/infotelefon")
}

const RUECKRUF: &str = r#"{"anliegen":"vermisstensuche","notiz":"sucht Vater","anrufer_name":"K. Meyer","rueckruf":"0171 000000","rueckruf_noetig":true}"#;

#[tokio::test]
async fn anruf_erfassen_erledigen_oeffnen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;

    let (s, a) = anfrage(
        &app,
        "POST",
        &pfad(e),
        &admin,
        Some(r#"{"anliegen":"auskunft_lage","notiz":"Sperrung B 3"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{a:?}");
    assert_eq!(a["status"], "erledigt", "ohne Rückruf erledigt");

    let (s, a) = anfrage(&app, "POST", &pfad(e), &admin, Some(RUECKRUF)).await;
    assert_eq!(s, StatusCode::CREATED, "{a:?}");
    assert_eq!(a["status"], "offen");
    let id = a["id"].as_i64().unwrap();

    let (s, a) = anfrage(
        &app,
        "POST",
        &format!("{}/{id}/status", pfad(e)),
        &admin,
        Some(r#"{"status":"erledigt"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{a:?}");
    assert_eq!(a["status"], "erledigt");
    assert!(a["erledigt_at"].is_string());

    let (s, a) = anfrage(
        &app,
        "POST",
        &format!("{}/{id}/status", pfad(e)),
        &admin,
        Some(r#"{"status":"offen"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{a:?}");
    assert_eq!(a["status"], "offen");

    let (s, l) = anfrage(&app, "GET", &pfad(e), &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(l.as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn statuscodes_des_infotelefons() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let anderer = einsatz_anlegen(&app, &admin).await;

    for (body, erwartet, fall) in [
        (
            r#"{"anliegen":"spende"}"#,
            StatusCode::BAD_REQUEST,
            "unbekanntes Anliegen",
        ),
        (
            r#"{"notiz":"x"}"#,
            StatusCode::BAD_REQUEST,
            "Anliegen fehlt",
        ),
        (
            r#"{"anliegen":"hinweis","eingang_at":"gestern"}"#,
            StatusCode::BAD_REQUEST,
            "unlesbare Uhrzeit",
        ),
        (
            r#"{"anliegen":"hinweis","rueckruf_noetig":true}"#,
            StatusCode::UNPROCESSABLE_ENTITY,
            "Rückruf ohne Nummer",
        ),
    ] {
        let (s, _) = anfrage(&app, "POST", &pfad(e), &admin, Some(body)).await;
        assert_eq!(s, erwartet, "{fall}");
    }
    let (_, l) = anfrage(&app, "GET", &pfad(e), &admin, None).await;
    assert!(l.as_array().unwrap().is_empty(), "nichts angelegt");

    let (_, a) = anfrage(&app, "POST", &pfad(e), &admin, Some(RUECKRUF)).await;
    let id = a["id"].as_i64().unwrap();
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("{}/{id}/status", pfad(e)),
        &admin,
        Some(r#"{"status":"vergessen"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("{}/{id}/status", pfad(anderer)),
        &admin,
        Some(r#"{"status":"erledigt"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (s, _) = anfrage(&app, "DELETE", &format!("{}/{id}", pfad(e)), &admin, None).await;
    assert!(
        s == StatusCode::NOT_FOUND || s == StatusCode::METHOD_NOT_ALLOWED,
        "kein Löschen: {s}"
    );
}

#[tokio::test]
async fn beobachter_liest_aber_erfasst_nicht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (_, a) = anfrage(&app, "POST", &pfad(e), &admin, Some(RUECKRUF)).await;
    let id = a["id"].as_i64().unwrap();
    let bid = benutzer_anlegen(&app, &admin, "beobachter", "keine").await;
    rolle_setzen(&app, &admin, e, bid, "beobachter").await;
    let beob = login_cookie(&app, "beobachter", "beobachterpw1").await;

    let (s, _) = anfrage(&app, "GET", &pfad(e), &beob, None).await;
    assert_eq!(s, StatusCode::OK);
    let (s, _) = anfrage(&app, "POST", &pfad(e), &beob, Some(RUECKRUF)).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("{}/{id}/status", pfad(e)),
        &beob,
        Some(r#"{"status":"erledigt"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn abgeschlossener_einsatz_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/abschliessen"),
        &admin,
        None,
    )
    .await;
    assert!(s.is_success(), "Einsatz abschließen: {s}");
    let (s, _) = anfrage(&app, "POST", &pfad(e), &admin, Some(RUECKRUF)).await;
    assert_eq!(s, StatusCode::CONFLICT);
    let (s, _) = anfrage(&app, "GET", &pfad(e), &admin, None).await;
    assert_eq!(s, StatusCode::OK);
}

/// Spec „Zwei Telefonplätze“: das Ereignis `infotelefon` trägt nur Kennungen.
#[tokio::test]
async fn live_ereignis_nur_mit_kennungen() {
    let (app, live) = setup_mit_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let mut rx = live.abonniere(e);
    let (_, a) = anfrage(&app, "POST", &pfad(e), &admin, Some(RUECKRUF)).await;
    let n = recv_until_tag(&mut rx, "infotelefon", Duration::from_secs(1)).await;
    let v: Value = serde_json::from_str(&n.data).unwrap();
    assert_eq!(v["anruf_id"], a["id"]);
    for pii in ["Meyer", "0171", "Vater"] {
        assert!(!n.data.contains(pii), "{pii} im Ereignis: {}", n.data);
    }
}
