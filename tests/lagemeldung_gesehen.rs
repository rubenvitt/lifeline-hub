//! Kenntnisnahme einer Lagemeldung (LLH-1206, Spec `lagemeldung-kenntnisnahme`): „neu“ gilt für
//! alle, gesetzt mit Schreibrecht am Modul `lagemeldungen`, die erste Kenntnisnahme gewinnt. Seit
//! LLH-1031 ist die Kennung einer Lagemeldung die ihrer Meldung, die Pfade sind neu.

use axum::http::StatusCode;
use serde_json::{json, Value};
use std::time::Duration;

mod common;
use common::{
    anfrage, benutzer_anlegen, einsatz_anlegen, login_cookie, recv_until_tag, rolle_setzen, setup,
    setup_mit_live,
};

async fn post(app: &axum::Router, cookie: &str, pfad: &str, body: &str) -> Value {
    let (status, v) = anfrage(app, "POST", pfad, cookie, Some(body)).await;
    assert!(status.is_success(), "POST {pfad}: {status} {v:?}");
    v
}

/// Legt eine Meldung an und übergibt sie an die Lage; liefert die Kennung der Meldung, die auch
/// die der Lagemeldung ist.
async fn uebergeben(app: &axum::Router, cookie: &str, e: i64, inhalt: &str) -> i64 {
    let m = post(
        app,
        cookie,
        &format!("/api/einsaetze/{e}/meldungen"),
        &json!({
            "absender": "Florian Nord 1", "empfaenger": "ELW 1", "meldeweg": "funk",
            "inhalt": inhalt, "ereigniszeit": "2026-06-12 09:00:00"
        })
        .to_string(),
    )
    .await;
    let mid = m["id"].as_i64().unwrap();
    let m = post(
        app,
        cookie,
        &format!("/api/einsaetze/{e}/meldungen/{mid}/lagerelevant"),
        "{}",
    )
    .await;
    assert_eq!(m["lagerelevant"], true, "{m:?}");
    mid
}

/// Pfad der einzelnen Kenntnisnahme.
fn einzeln(e: i64, mid: i64) -> String {
    format!("/api/einsaetze/{e}/meldungen/{mid}/lage-gesehen")
}

/// Pfad des Sammelwegs.
fn sammel(e: i64) -> String {
    format!("/api/einsaetze/{e}/lage/gesehen")
}

async fn liste(app: &axum::Router, cookie: &str, e: i64) -> Vec<Value> {
    let (status, v) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{e}/lage/meldungen"),
        cookie,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{v:?}");
    v.as_array().unwrap().clone()
}

fn zeile(liste: &[Value], id: i64) -> &Value {
    liste.iter().find(|l| l["id"] == id).unwrap()
}

async fn zaehler(app: &axum::Router, cookie: &str, e: i64) -> Value {
    let (status, v) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{e}/modul-zaehler"),
        cookie,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{v:?}");
    v
}

/// Beobachterin ohne Admin-Rechte im Einsatz: liest, schreibt nicht.
async fn erika(app: &axum::Router, admin: &str, e: i64) -> String {
    let id = benutzer_anlegen(app, admin, "erika", "keine").await;
    rolle_setzen(app, admin, e, id, "beobachter").await;
    login_cookie(app, "erika", "erikapw1").await
}

#[tokio::test]
async fn einzeln_gesehen_gilt_fuer_alle_und_die_erste_gewinnt() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let lid = uebergeben(&app, &admin, e, "Brücke gesperrt").await;
    let erika = erika(&app, &admin, e).await;

    let frisch = liste(&app, &erika, e).await;
    assert_eq!(zeile(&frisch, lid)["is_neu"], true);
    assert!(zeile(&frisch, lid).get("gesehen_at").is_none());

    let pfad = einzeln(e, lid);
    let erst = post(&app, &admin, &pfad, "{}").await;
    assert_eq!(erst["is_neu"], false, "{erst:?}");
    assert_eq!(erst["gesehen_von_name"], "Administrator", "{erst:?}");
    let gesehen_at = erst["gesehen_at"].clone();
    assert!(gesehen_at.is_string(), "{erst:?}");

    // Dieselbe Sicht für die Beobachterin.
    let fuer_erika = liste(&app, &erika, e).await;
    assert_eq!(zeile(&fuer_erika, lid)["is_neu"], false);
    assert_eq!(zeile(&fuer_erika, lid)["gesehen_von_name"], "Administrator");

    // Zweites Mal: 200, Zeitpunkt und Person unverändert.
    let zweit = post(&app, &admin, &pfad, "{}").await;
    assert_eq!(zweit["gesehen_at"], gesehen_at);
}

/// Spec-Szenario „Alle bis zur angezeigten“: die Seite zeigt 4 und 5, während des Klicks kommt
/// die ältere 3 in die Lage; markiert werden nur die angezeigten.
#[tokio::test]
async fn alle_angezeigten_gesehen_laesst_die_waehrenddessen_uebernommene_neu() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let m = post(
        &app,
        &admin,
        &format!("/api/einsaetze/{e}/meldungen"),
        &json!({
            "absender": "Florian Nord 1", "meldeweg": "funk", "inhalt": "drei",
            "ereigniszeit": "2026-06-12 08:00:00"
        })
        .to_string(),
    )
    .await;
    let drei = m["id"].as_i64().unwrap();
    let vier = uebergeben(&app, &admin, e, "vier").await;
    let fuenf = uebergeben(&app, &admin, e, "fünf").await;
    post(
        &app,
        &admin,
        &format!("/api/einsaetze/{e}/meldungen/{drei}/lagerelevant"),
        "{}",
    )
    .await;

    let v = post(
        &app,
        &admin,
        &sammel(e),
        &json!({ "meldung_ids": [vier, fuenf] }).to_string(),
    )
    .await;
    assert_eq!(v, json!({ "gesehen": 2 }));

    let l = liste(&app, &admin, e).await;
    assert_eq!(zeile(&l, vier)["is_neu"], false);
    assert_eq!(zeile(&l, fuenf)["is_neu"], false);
    assert_eq!(
        zeile(&l, drei)["is_neu"],
        true,
        "nicht angezeigt bleibt neu"
    );
}

/// Spec `meldungseingang`, „Frisch erfasst“: eine Meldung der Art „Lagemeldung“ steht ohne
/// weiteren Schritt neu in der Liste, mit der Kennung der Meldung und ihrem Wortlaut; eine andere
/// Art ohne Übernahme fehlt. Die Kenntnisnahme läuft über dieselbe Kennung.
#[tokio::test]
async fn erfasste_lagemeldung_steht_neu_in_der_liste() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let lm = post(
        &app,
        &admin,
        &format!("/api/einsaetze/{e}/meldungen"),
        &json!({
            "absender": "Florian Nord 1", "meldeweg": "funk", "meldungsart": "lagemeldung",
            "prioritaet": "dringend", "inhalt": "Brand unter Kontrolle",
            "ereigniszeit": "2026-06-12 09:00:00", "lat": 51.4, "lon": 10.4
        })
        .to_string(),
    )
    .await;
    assert_eq!(lm["lagerelevant"], true, "{lm:?}");
    let mid = lm["id"].as_i64().unwrap();
    post(
        &app,
        &admin,
        &format!("/api/einsaetze/{e}/meldungen"),
        &json!({
            "absender": "Florian Nord 1", "meldeweg": "funk", "meldungsart": "rueckmeldung",
            "inhalt": "Einsatzbereit", "ereigniszeit": "2026-06-12 09:01:00"
        })
        .to_string(),
    )
    .await;

    let l = liste(&app, &admin, e).await;
    assert_eq!(l.len(), 1, "{l:?}");
    let z = zeile(&l, mid);
    assert_eq!(z["meldung_id"], mid);
    assert_eq!(z["text"], "Brand unter Kontrolle");
    assert_eq!(z["is_neu"], true);
    assert!(z.get("gesehen_at").is_none());
    assert_eq!(z["meldungsart"], "lagemeldung");
    assert_eq!(z["prioritaet"], "dringend");
    assert_eq!(z["meldung_status"], "neu");
    assert_eq!(z["richtung"], "intern");
    assert_eq!(z["is_von_geraet"], false);
    assert_eq!(
        (z["lat"].clone(), z["lon"].clone()),
        (json!(51.4), json!(10.4))
    );
    assert_eq!(z["ereigniszeit"], "2026-06-12 09:00:00");

    let gesehen = post(&app, &admin, &einzeln(e, mid), "{}").await;
    assert_eq!(gesehen["is_neu"], false, "{gesehen:?}");
}

/// Verortet wird beim Erfassen nur eine Lagemeldung (422); die Koordinate als Paar (422).
#[tokio::test]
async fn verortung_beim_erfassen_nur_fuer_lagemeldung() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    for body in [
        json!({ "absender": "A", "meldeweg": "funk", "inhalt": "X", "meldungsart": "anfrage",
                "ereigniszeit": "2026-06-12 09:00:00", "lat": 51.4, "lon": 10.4 }),
        json!({ "absender": "A", "meldeweg": "funk", "inhalt": "X", "meldungsart": "lagemeldung",
                "ereigniszeit": "2026-06-12 09:00:00", "lat": 51.4 }),
    ] {
        let (status, v) = anfrage(
            &app,
            "POST",
            &format!("/api/einsaetze/{e}/meldungen"),
            &admin,
            Some(&body.to_string()),
        )
        .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body} {v:?}");
    }
}

/// LLH-1027 D6: die alten Pfade mit der Kennung des Lageobjekts gibt es nicht mehr; ein altes
/// Bundle markiert damit nichts.
#[tokio::test]
async fn alte_pfade_der_kenntnisnahme_sind_404() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let mid = uebergeben(&app, &admin, e, "Brücke gesperrt").await;
    for (pfad, body) in [
        (
            format!("/api/einsaetze/{e}/lage/meldungen/{mid}/gesehen"),
            "{}".to_string(),
        ),
        (
            format!("/api/einsaetze/{e}/lage/meldungen/gesehen"),
            json!({ "bis_id": mid }).to_string(),
        ),
    ] {
        let (status, _) = anfrage(&app, "POST", &pfad, &admin, Some(&body)).await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{pfad}");
    }
    assert_eq!(zeile(&liste(&app, &admin, e).await, mid)["is_neu"], true);
}

/// Spec-Szenario „Nicht in der Lage“: eine Meldung ohne Lagerelevanz ist 404.
#[tokio::test]
async fn meldung_ausserhalb_der_lage_ist_404() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let m = post(
        &app,
        &admin,
        &format!("/api/einsaetze/{e}/meldungen"),
        &json!({
            "absender": "Florian Nord 1", "meldeweg": "funk", "inhalt": "X",
            "ereigniszeit": "2026-06-12 09:00:00"
        })
        .to_string(),
    )
    .await;
    let mid = m["id"].as_i64().unwrap();
    let (status, _) = anfrage(&app, "POST", &einzeln(e, mid), &admin, Some("{}")).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let v = post(
        &app,
        &admin,
        &sammel(e),
        &json!({ "meldung_ids": [mid] }).to_string(),
    )
    .await;
    assert_eq!(v, json!({ "gesehen": 0 }));
}

#[tokio::test]
async fn nur_lesend_ist_403_und_bleibt_neu() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let lid = uebergeben(&app, &admin, e, "Brücke gesperrt").await;
    let erika = erika(&app, &admin, e).await;

    let (status, _) = anfrage(&app, "POST", &einzeln(e, lid), &erika, Some("{}")).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = anfrage(
        &app,
        "POST",
        &sammel(e),
        &erika,
        Some(&json!({ "meldung_ids": [lid] }).to_string()),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(zeile(&liste(&app, &admin, e).await, lid)["is_neu"], true);
}

#[tokio::test]
async fn lagemeldung_aus_fremdem_einsatz_ist_404() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let fremd = einsatz_anlegen(&app, &admin).await;
    let lid = uebergeben(&app, &admin, e, "Brücke gesperrt").await;

    let (status, _) = anfrage(&app, "POST", &einzeln(fremd, lid), &admin, Some("{}")).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    // Der Sammelweg im fremden Einsatz rührt die Lagemeldung nicht an.
    let v = post(
        &app,
        &admin,
        &sammel(fremd),
        &json!({ "meldung_ids": [lid] }).to_string(),
    )
    .await;
    assert_eq!(v, json!({ "gesehen": 0 }));
    assert_eq!(zeile(&liste(&app, &admin, e).await, lid)["is_neu"], true);
}

#[tokio::test]
async fn ohne_meldung_ids_oder_mit_zu_vielen_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let zu_viele: Vec<i64> = (1..=501).collect();
    for body in [
        "{}".to_string(),
        json!({ "meldung_ids": zu_viele }).to_string(),
    ] {
        let (status, _) = anfrage(&app, "POST", &sammel(e), &admin, Some(&body)).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }
}

#[tokio::test]
async fn beide_wege_melden_den_kurzruf_meldung() {
    let (app, live) = setup_mit_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let a = uebergeben(&app, &admin, e, "eins").await;
    let b = uebergeben(&app, &admin, e, "zwei").await;
    let mut rx = live.abonniere(e);

    post(&app, &admin, &einzeln(e, a), "{}").await;
    recv_until_tag(&mut rx, "meldung", Duration::from_secs(1)).await;

    post(
        &app,
        &admin,
        &sammel(e),
        &json!({ "meldung_ids": [b] }).to_string(),
    )
    .await;
    recv_until_tag(&mut rx, "meldung", Duration::from_secs(1)).await;
}

/// Spec `modul-zaehler`: `lagemeldungen.neu` gleich den Listeneinträgen mit `is_neu`, für jeden
/// Benutzer gleich; ausgeblendet fehlt das Feld.
#[tokio::test]
async fn zaehler_neu_entspricht_der_liste_und_fehlt_ohne_freigabe() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let erika = erika(&app, &admin, e).await;
    assert_eq!(
        zaehler(&app, &admin, e).await["lagemeldungen"],
        json!({ "neu": 0 })
    );

    let a = uebergeben(&app, &admin, e, "eins").await;
    uebergeben(&app, &admin, e, "zwei").await;
    uebergeben(&app, &admin, e, "drei").await;
    // Eine erfasste Lagemeldung zählt mit (LLH-1031).
    post(
        &app,
        &admin,
        &format!("/api/einsaetze/{e}/meldungen"),
        &json!({
            "absender": "Florian Nord 1", "meldeweg": "funk", "meldungsart": "lagemeldung",
            "inhalt": "vier", "ereigniszeit": "2026-06-12 09:00:00"
        })
        .to_string(),
    )
    .await;
    post(&app, &admin, &einzeln(e, a), "{}").await;

    let neu_in_liste = liste(&app, &admin, e)
        .await
        .iter()
        .filter(|l| l["is_neu"] == true)
        .count() as i64;
    assert_eq!(neu_in_liste, 3);
    for cookie in [&admin, &erika] {
        let v = zaehler(&app, cookie, e).await;
        assert_eq!(v["lagemeldungen"], json!({ "neu": neu_in_liste }), "{v:?}");
    }

    let (status, v) = anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{e}/modul-overrides/lagemeldungen"),
        &admin,
        Some(r#"{"sichtbar":false,"benoetigte_rolle":null}"#),
    )
    .await;
    assert!(status.is_success(), "Override: {status} {v:?}");
    let v = zaehler(&app, &erika, e).await;
    assert!(
        !v.as_object().unwrap().contains_key("lagemeldungen"),
        "{v:?}"
    );
    assert!(v.as_object().unwrap().contains_key("etb"), "{v:?}");
}
