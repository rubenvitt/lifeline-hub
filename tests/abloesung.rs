//! Integrationstests der Ablösung (LFH-635): Statuscodes je Endpunkt und ein Durchstich
//! Beginnen → Vorgabe verkürzen → Vollziehen → Zurücknehmen samt ETB-Nachweis.
//!
//! Das Modul-Gate (403 bei ausgeblendetem Modul) deckt `tests/modul_override.rs` über
//! `MODUL_GET_PFADE` ab; die Fachlogik der Schreibpfade `src/abloesung/repo/tests.rs`.

use axum::http::StatusCode;

mod common;
use common::*;

fn pfad(einsatz: i64) -> String {
    format!("/api/einsaetze/{einsatz}/abloesungen")
}

async fn abschnitt(app: &axum::Router, cookie: &str, einsatz: i64, name: &str) -> i64 {
    let (s, json) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschnitte"),
        cookie,
        Some(&format!(r#"{{"name":"{name}"}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "Abschnitt: {json:?}");
    json["id"].as_i64().unwrap()
}

async fn einheit(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    name: &str,
    abschnitt: Option<i64>,
) -> i64 {
    let body = match abschnitt {
        Some(a) => format!(r#"{{"name":"{name}","abschnitt_id":{a}}}"#),
        None => format!(r#"{{"name":"{name}"}}"#),
    };
    let (s, json) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/einheiten"),
        cookie,
        Some(&body),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "Einheit: {json:?}");
    json["id"].as_i64().unwrap()
}

async fn etb_eintraege(app: &axum::Router, cookie: &str, einsatz: i64) -> Vec<serde_json::Value> {
    let (_, json) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/etb"),
        cookie,
        None,
    )
    .await;
    json.as_array().cloned().unwrap_or_default()
}

fn treffer(etb: &[serde_json::Value], typ: &str, nadel: &str) -> Vec<serde_json::Value> {
    etb.iter()
        .filter(|e| e["typ"] == typ && e["inhalt"].as_str().is_some_and(|i| i.contains(nadel)))
        .cloned()
        .collect()
}

#[tokio::test]
async fn durchstich_beginnen_vorgabe_vollzug_ruecknahme() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let nord = abschnitt(&app, &admin, e, "Deichwache Nord").await;
    let f1 = einheit(&app, &admin, e, "Florian 1", Some(nord)).await;
    let f2 = einheit(&app, &admin, e, "Florian 2", None).await;

    // Vorgabe 8 h am Abschnitt
    let (s, json) = anfrage(
        &app,
        "PUT",
        &format!("{}/vorgaben/{nord}", pfad(e)),
        &admin,
        Some(r#"{"rhythmus_minuten":480}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{json:?}");
    assert_eq!(json[0]["rhythmus_minuten"], 480);

    // Schicht ohne eigenen Rhythmus → Vorgabe
    let (s, schicht) = anfrage(
        &app,
        "POST",
        &pfad(e),
        &admin,
        Some(&format!(
            r#"{{"einheit_id":{f1},"beginn_at":"2026-09-22T09:30:00Z"}}"#
        )),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{schicht:?}");
    assert_eq!(schicht["faellig_at"], "2026-09-22 17:30:00");
    assert_eq!(schicht["rhythmus_quelle"], "abschnitt");
    assert_eq!(schicht["einheit_name"], "Florian 1");
    let id = schicht["id"].as_i64().unwrap();

    // Vorgabe auf 6 h verkürzt → Entscheidung im ETB, Schicht wandert mit
    let (s, _) = anfrage(
        &app,
        "PUT",
        &format!("{}/vorgaben/{nord}", pfad(e)),
        &admin,
        Some(r#"{"rhythmus_minuten":360}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (_, liste) = anfrage(
        &app,
        "GET",
        &format!("{}?status=laufend", pfad(e)),
        &admin,
        None,
    )
    .await;
    assert_eq!(liste[0]["faellig_at"], "2026-09-22 15:30:00");
    let etb = etb_eintraege(&app, &admin, e).await;
    assert_eq!(treffer(&etb, "entscheidung", "Deichwache Nord").len(), 2);

    // Vollzug durch Florian 2
    let (s, v) = anfrage(
        &app,
        "POST",
        &format!("{}/{id}/vollzug", pfad(e)),
        &admin,
        Some(&format!(
            r#"{{"vollzogen_at":"2026-09-22T15:40:00Z","abloesende_einheit_id":{f2}}}"#
        )),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v:?}");
    assert_eq!(v["abgeloest"]["status"], "abgeloest");
    assert_eq!(v["abgeloest"]["ruecknehmbar"], true);
    assert_eq!(v["folgeschicht"]["einheit_name"], "Florian 2");
    assert_eq!(v["folgeschicht"]["faellig_at"], "2026-09-22 21:40:00");
    assert!(
        v["abgeloest"]
            .as_object()
            .unwrap()
            .get("einstufung")
            .is_none(),
        "abgelöste Schicht trägt keine Einstufung"
    );
    let etb = etb_eintraege(&app, &admin, e).await;
    let vollzug = treffer(&etb, "meldung", "Ablösung vollzogen");
    assert_eq!(vollzug.len(), 1);
    assert!(vollzug[0]["inhalt"].as_str().unwrap().contains("Florian 2"));

    // Rücknahme
    let (s, r) = anfrage(
        &app,
        "POST",
        &format!("{}/{id}/vollzug/zuruecknehmen", pfad(e)),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{r:?}");
    assert_eq!(r["status"], "laufend");
    let etb = etb_eintraege(&app, &admin, e).await;
    let berichtigung = treffer(&etb, "berichtigung", "zurückgenommen");
    assert_eq!(berichtigung.len(), 1);
    assert_eq!(berichtigung[0]["berichtigt_eintrag_id"], vollzug[0]["id"]);
    let (_, laufend) = anfrage(
        &app,
        "GET",
        &format!("{}?status=laufend", pfad(e)),
        &admin,
        None,
    )
    .await;
    assert_eq!(
        laufend.as_array().unwrap().len(),
        1,
        "Folgeschicht entfernt"
    );

    // Doppelte Rücknahme → 422
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("{}/{id}/vollzug/zuruecknehmen", pfad(e)),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn statuscodes() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let f1 = einheit(&app, &admin, e, "Florian 1", None).await;

    // 400: unbekannter Status-Filter
    let (s, _) = anfrage(
        &app,
        "GET",
        &format!("{}?status=offen", pfad(e)),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    // 400: Rhythmus außerhalb, fehlender Rhythmus ohne Vorgabe, unparsbare Zeit
    for body in [
        format!(r#"{{"einheit_id":{f1},"rhythmus_minuten":0}}"#),
        format!(r#"{{"einheit_id":{f1},"rhythmus_minuten":10081}}"#),
        format!(r#"{{"einheit_id":{f1}}}"#),
        format!(r#"{{"einheit_id":{f1},"rhythmus_minuten":60,"beginn_at":"gestern"}}"#),
    ] {
        let (s, j) = anfrage(&app, "POST", &pfad(e), &admin, Some(&body)).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{body} → {j:?}");
    }
    // 400: Vorgabe ohne Feld
    let nord = abschnitt(&app, &admin, e, "Nord").await;
    let (s, _) = anfrage(
        &app,
        "PUT",
        &format!("{}/vorgaben/{nord}", pfad(e)),
        &admin,
        Some("{}"),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    // 404: fremde Einheit, unbekannte Schicht, fremder Abschnitt
    let e2 = einsatz_anlegen(&app, &admin).await;
    let fremd = einheit(&app, &admin, e2, "Fremd", None).await;
    let (s, _) = anfrage(
        &app,
        "POST",
        &pfad(e),
        &admin,
        Some(&format!(
            r#"{{"einheit_id":{fremd},"rhythmus_minuten":60}}"#
        )),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("{}/999999/vollzug", pfad(e)),
        &admin,
        Some("{}"),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let fremd_abschnitt = abschnitt(&app, &admin, e2, "Fremd").await;
    let (s, _) = anfrage(
        &app,
        "PUT",
        &format!("{}/vorgaben/{fremd_abschnitt}", pfad(e)),
        &admin,
        Some(r#"{"rhythmus_minuten":60}"#),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    // 400: nicht-numerische Sub-ID (PfadParam)
    let (s, _) = anfrage(
        &app,
        "PATCH",
        &format!("{}/abc", pfad(e)),
        &admin,
        Some("{}"),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);

    // 422: zweite laufende Schicht
    let body = format!(r#"{{"einheit_id":{f1},"rhythmus_minuten":60}}"#);
    let (s, _) = anfrage(&app, "POST", &pfad(e), &admin, Some(&body)).await;
    assert_eq!(s, StatusCode::CREATED);
    let (s, _) = anfrage(&app, "POST", &pfad(e), &admin, Some(&body)).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn beobachter_liest_aber_schreibt_nicht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let f1 = einheit(&app, &admin, e, "Florian 1", None).await;
    let beob = benutzer_anlegen(&app, &admin, "beobachter", "keine").await;
    rolle_setzen(&app, &admin, e, beob, "beobachter").await;
    let beob_cookie = login_cookie(&app, "beobachter", "beobachterpw1").await;

    let (s, _) = anfrage(&app, "GET", &pfad(e), &beob_cookie, None).await;
    assert_eq!(s, StatusCode::OK);
    let (s, _) = anfrage(
        &app,
        "GET",
        &format!("{}/vorgaben", pfad(e)),
        &beob_cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (s, _) = anfrage(
        &app,
        "POST",
        &pfad(e),
        &beob_cookie,
        Some(&format!(r#"{{"einheit_id":{f1},"rhythmus_minuten":60}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
}
