//! Integrationstests der taktischen Fernmeldeskizze (LFH-893), Backend-Teil.
//!
//! Spec: `openspec/changes/archive/2026-10-05-lfh-893-taktische-fernmeldeskizze/specs/stab-fernmeldeskizze-bearbeitung/spec.md`,
//! API-Vertrag `design.md` D14. Die tragenden Aussagen: Lesen mit Vorgaben, Lage mit erwarteter
//! Version (409 statt stillem Überschreiben), Neu anordnen verwirft nur Lagen, Komponenten,
//! Verbindungen und Bereiche mit Validierung (400/422), Schriftfeld Tri-State, jede Änderung sendet
//! `stab` und nie `etb`, Bezüge verwaisen nicht, die Schwärzung nimmt Namen und Hinweise.

use axum::http::StatusCode;
use lifeline_hub::live::{LiveEvent, LiveNachricht};
use serde_json::{json, Value};
use tokio::sync::broadcast::Receiver;

mod common;
use common::*;

fn basis(einsatz: i64) -> String {
    format!("/api/einsaetze/{einsatz}/stab/fernmeldeskizze")
}

async fn skizze(app: &axum::Router, cookie: &str, einsatz: i64) -> Value {
    let (status, json) = anfrage(app, "GET", &basis(einsatz), cookie, None).await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    json
}

async fn senden(
    app: &axum::Router,
    cookie: &str,
    methode: &str,
    pfad: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    anfrage_json(app, methode, pfad, cookie, body.as_ref()).await
}

async fn abschnitt(app: &axum::Router, cookie: &str, einsatz: i64, name: &str) -> i64 {
    let (s, json) = anfrage_json(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschnitte"),
        cookie,
        Some(&json!({"name": name})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "Abschnitt: {json:?}");
    json["id"].as_i64().unwrap()
}

async fn lokale_sprechgruppe(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    bezeichnung: &str,
    betriebsart: &str,
) -> i64 {
    let (status, json) = anfrage_json(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/sprechgruppen"),
        cookie,
        Some(&json!({"bezeichnung": bezeichnung, "betriebsart": betriebsart})),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{json:?}");
    json["id"].as_i64().unwrap()
}

async fn stelle(app: &axum::Router, cookie: &str, einsatz: i64, body: Value) -> i64 {
    let (status, plan) = anfrage_json(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/stab/kommunikationsplan/stellen"),
        cookie,
        Some(&body),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{plan:?}");
    plan.as_array()
        .unwrap()
        .iter()
        .map(|s| s["id"].as_i64().unwrap())
        .max()
        .unwrap()
}

async fn komponente(app: &axum::Router, cookie: &str, einsatz: i64, body: Value) -> Value {
    let (status, json) = senden(
        app,
        cookie,
        "POST",
        &format!("{}/komponenten", basis(einsatz)),
        Some(body),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{json:?}");
    json
}

async fn verbindung(app: &axum::Router, cookie: &str, einsatz: i64, body: Value) -> Value {
    let (status, json) = senden(
        app,
        cookie,
        "POST",
        &format!("{}/verbindungen", basis(einsatz)),
        Some(body),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{json:?}");
    json
}

fn zaehle(rx: &mut Receiver<LiveNachricht>) -> (usize, usize) {
    let (mut stab, mut etb) = (0, 0);
    while let Ok(n) = rx.try_recv() {
        match n.event {
            LiveEvent::Stab => stab += 1,
            LiveEvent::Etb => etb += 1,
            _ => {}
        }
    }
    (stab, etb)
}

// ---------- Lesen ----------

#[tokio::test]
async fn neue_skizze_ist_leer_mit_vorgaben_im_schriftfeld() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen_mit(&app, &admin, "Hochwasser Elbe").await;
    let s = skizze(&app, &admin, einsatz).await;
    assert_eq!(
        s,
        json!({
            "lage": [],
            "komponenten": [],
            "verbindungen": [],
            "bereiche": [],
            "schriftfeld": {
                "herausgeber": null,
                "vs_vermerk": "keiner",
                "gueltig_ab": null,
                "gez_name": null,
                "gez_at": null
            },
            "stand": null
        })
    );
}

#[tokio::test]
async fn ohne_stab_recht_ist_lesen_und_schreiben_403() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let id = benutzer_anlegen(&app, &admin, "frieda", "keine").await;
    rolle_setzen(&app, &admin, einsatz, id, "fuehrungspersonal").await;
    let frieda = login_cookie(&app, "frieda", "friedapw1").await;
    // Mit Recht: lesen und schreiben.
    skizze(&app, &frieda, einsatz).await;
    let (status, _) = senden(
        &app,
        &frieda,
        "PUT",
        &format!("{}/lage/fs", basis(einsatz)),
        Some(json!({"x": 8, "y": 16, "version": null})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, _) = anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/modul-overrides/stab"),
        &admin,
        Some(r#"{"sichtbar":true,"benoetigte_rolle":"admin"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = anfrage(&app, "GET", &basis(einsatz), &frieda, None).await;
    assert_eq!(status, StatusCode::FORBIDDEN, "Stab gesperrt → 403");
    let (status, _) = senden(
        &app,
        &frieda,
        "POST",
        &format!("{}/komponenten", basis(einsatz)),
        Some(json!({"art": "repeater"})),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn beobachter_liest_aber_schreibt_nicht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let k = komponente(&app, &admin, einsatz, json!({"art": "repeater"})).await;
    let kid = k["id"].as_i64().unwrap();
    let beob = benutzer_anlegen(&app, &admin, "beobachter", "keine").await;
    rolle_setzen(&app, &admin, einsatz, beob, "beobachter").await;
    let beob = login_cookie(&app, "beobachter", "beobachterpw1").await;
    assert_eq!(
        skizze(&app, &beob, einsatz).await["komponenten"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let b = basis(einsatz);
    for (methode, pfad, body) in [
        (
            "PUT",
            format!("{b}/lage/fs"),
            Some(json!({"x": 0, "y": 0, "version": null})),
        ),
        ("DELETE", format!("{b}/lage"), None),
        (
            "PUT",
            format!("{b}/schriftfeld"),
            Some(json!({"gez_name": "x"})),
        ),
        (
            "POST",
            format!("{b}/komponenten"),
            Some(json!({"art": "antenne"})),
        ),
        (
            "PATCH",
            format!("{b}/komponenten/{kid}"),
            Some(json!({"art": "antenne"})),
        ),
        ("DELETE", format!("{b}/komponenten/{kid}"), None),
        (
            "POST",
            format!("{b}/verbindungen"),
            Some(json!({"von": {"art": "fuehrungsstelle", "id": null},
                        "nach": {"art": "komponente", "id": kid},
                        "art": "daten", "medium": "leitung", "status": "geplant"})),
        ),
        (
            "POST",
            format!("{b}/bereiche"),
            Some(json!({"x": 0, "y": 0, "breite": 80, "hoehe": 40})),
        ),
    ] {
        let (status, _) = senden(&app, &beob, methode, &pfad, body).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{methode} {pfad}");
    }
}

// ---------- Lage ----------

#[tokio::test]
async fn zwei_personen_ziehen_dieselbe_einheit() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let eh = einheit_bilden(&app, &admin, einsatz, "1. Zug").await;
    let pfad = format!("{}/lage/eh-{eh}", basis(einsatz));

    // Erstes Verschieben: noch keine Zeile erwartet.
    let (status, a0) = senden(
        &app,
        &admin,
        "PUT",
        &pfad,
        Some(json!({"x": 80, "y": 160, "version": null})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{a0:?}");
    assert_eq!(
        a0,
        json!({"element": format!("eh-{eh}"), "x": 80.0, "y": 160.0, "breite": null, "version": 1})
    );

    // A und B gehen beide von Version 1 aus; A speichert zuerst.
    let (status, a) = senden(
        &app,
        &admin,
        "PUT",
        &pfad,
        Some(json!({"x": 240, "y": 160, "version": 1})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(a["version"], 2);
    let (status, b) = senden(
        &app,
        &admin,
        "PUT",
        &pfad,
        Some(json!({"x": 400, "y": 40, "version": 1})),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{b:?}");
    assert!(b["error"].is_string(), "Fehlerformat bleibt: {b:?}");
    assert_eq!(b["aktuell"]["x"], 240.0, "409 trägt A's Stand: {b:?}");
    assert_eq!(b["aktuell"]["version"], 2);

    // Wer „noch keine Zeile“ erwartet, obwohl es eine gibt, bekommt ebenfalls 409.
    let (status, c) = senden(
        &app,
        &admin,
        "PUT",
        &pfad,
        Some(json!({"x": 1, "y": 1, "version": null})),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(c["aktuell"]["version"], 2);

    let s = skizze(&app, &admin, einsatz).await;
    assert_eq!(s["lage"].as_array().unwrap().len(), 1);
    assert_eq!(s["lage"][0]["x"], 240.0, "nichts still überschrieben");
    assert!(s["stand"].is_string(), "Stand aus der letzten Änderung");
}

#[tokio::test]
async fn lage_mit_version_ohne_zeile_ist_409_mit_leerem_stand() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (status, json) = senden(
        &app,
        &admin,
        "PUT",
        &format!("{}/lage/fs", basis(einsatz)),
        Some(json!({"x": 1, "y": 1, "version": 3})),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(json["aktuell"], Value::Null);
}

#[tokio::test]
async fn lage_prueft_element_und_werte() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let anderer = einsatz_anlegen(&app, &admin).await;
    let fremde_einheit = einheit_bilden(&app, &admin, anderer, "Fremd").await;
    let sg = lokale_sprechgruppe(&app, &admin, einsatz, "311", "TMO").await;
    let ab = abschnitt(&app, &admin, einsatz, "EA 1").await;
    let b = basis(einsatz);
    let ok = json!({"x": 0, "y": 0, "version": null});

    for element in ["xx-1", "eh-", "eh-abc", "fs-1", "EH-1", "eh--1"] {
        let (status, _) = senden(
            &app,
            &admin,
            "PUT",
            &format!("{b}/lage/{element}"),
            Some(ok.clone()),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{element}");
    }
    // Ein Element, das es im Einsatz nicht gibt: Zusammenhang → 422.
    let (status, _) = senden(
        &app,
        &admin,
        "PUT",
        &format!("{b}/lage/eh-{fremde_einheit}"),
        Some(ok.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    // Schiene mit Breite, Abschnitt ohne.
    let (status, json) = senden(
        &app,
        &admin,
        "PUT",
        &format!("{b}/lage/sg-{sg}"),
        Some(json!({"x": 0, "y": 320, "breite": 640, "version": null})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(json["breite"], 640.0);
    let (status, _) = senden(
        &app,
        &admin,
        "PUT",
        &format!("{b}/lage/ab-{ab}"),
        Some(json!({"x": 0, "y": 0, "breite": 0, "version": null})),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "breite > 0");
    let (status, _) = senden(
        &app,
        &admin,
        "PUT",
        &format!("{b}/lage/ab-{ab}"),
        Some(json!({"x": 0, "version": null})),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "y fehlt");
}

#[tokio::test]
async fn neu_anordnen_verwirft_nur_die_lagen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let eh = einheit_bilden(&app, &admin, einsatz, "1. Zug").await;
    let b = basis(einsatz);
    let k = komponente(&app, &admin, einsatz, json!({"art": "repeater"})).await;
    let kid = k["id"].as_i64().unwrap();
    verbindung(
        &app,
        &admin,
        einsatz,
        json!({"von": {"art": "einheit", "id": eh}, "nach": {"art": "komponente", "id": kid},
               "art": "melder", "medium": "leitung", "status": "bestehend"}),
    )
    .await;
    for element in ["fs".to_string(), format!("eh-{eh}"), format!("ko-{kid}")] {
        let (status, _) = senden(
            &app,
            &admin,
            "PUT",
            &format!("{b}/lage/{element}"),
            Some(json!({"x": 16, "y": 16, "version": null})),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
    }
    assert_eq!(
        skizze(&app, &admin, einsatz).await["lage"]
            .as_array()
            .unwrap()
            .len(),
        3
    );
    let (status, _) = senden(&app, &admin, "DELETE", &format!("{b}/lage"), None).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let s = skizze(&app, &admin, einsatz).await;
    assert_eq!(s["lage"], json!([]));
    assert_eq!(s["komponenten"].as_array().unwrap().len(), 1);
    assert_eq!(s["verbindungen"].as_array().unwrap().len(), 1);
    // Nach dem Neu anordnen beginnt die Lage wieder ohne Zeile.
    let (status, json) = senden(
        &app,
        &admin,
        "PUT",
        &format!("{b}/lage/fs"),
        Some(json!({"x": 0, "y": 0, "version": null})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["version"], 1);
}

/// Review O3: Rückgängig nach dem ersten Verschieben eines auto-gelegten Elements verwirft genau
/// dessen Lagezeile, mit erwarteter Version (409 statt stillem Löschen), idempotent und mit
/// Live-Ereignis nur bei echter Änderung.
#[tokio::test]
async fn einzelne_lage_verwerfen_mit_version() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let eh = einheit_bilden(&app, &admin, einsatz, "1. Zug").await;
    let b = basis(einsatz);
    for element in ["fs".to_string(), format!("eh-{eh}")] {
        let (status, _) = senden(
            &app,
            &admin,
            "PUT",
            &format!("{b}/lage/{element}"),
            Some(json!({"x": 16, "y": 16, "version": null})),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
    }
    let pfad = format!("{b}/lage/eh-{eh}");
    let mut rx = live.abonniere(einsatz);

    // Abweichende Version: 409 mit dem gespeicherten Stand, nichts gelöscht, kein Ereignis.
    let (status, json) = senden(&app, &admin, "DELETE", &pfad, Some(json!({"version": 7}))).await;
    assert_eq!(status, StatusCode::CONFLICT, "{json:?}");
    assert_eq!(json["aktuell"]["version"], 1);
    assert_eq!(zaehle(&mut rx), (0, 0));

    // Passende Version: genau diese Zeile ist weg, die übrigen bleiben.
    let (status, _) = senden(&app, &admin, "DELETE", &pfad, Some(json!({"version": 1}))).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(zaehle(&mut rx), (1, 0), "ein stab-Ereignis, kein ETB");
    let s = skizze(&app, &admin, einsatz).await;
    let lage: Vec<&str> = s["lage"]
        .as_array()
        .unwrap()
        .iter()
        .map(|l| l["element"].as_str().unwrap())
        .collect();
    assert_eq!(lage, ["fs"]);

    // Idempotent: noch einmal 204, ohne Ereignis.
    let (status, _) = senden(&app, &admin, "DELETE", &pfad, Some(json!({"version": 1}))).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(zaehle(&mut rx), (0, 0));

    // Version ist Pflicht, das Element wird geprüft.
    let (status, _) = senden(&app, &admin, "DELETE", &pfad, Some(json!({}))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = senden(
        &app,
        &admin,
        "DELETE",
        &format!("{b}/lage/xx-1"),
        Some(json!({"version": 1})),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

/// Review O3: dasselbe Recht wie das Verschieben.
#[tokio::test]
async fn einzelne_lage_verwerfen_braucht_stab_recht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let id = benutzer_anlegen(&app, &admin, "frieda", "keine").await;
    rolle_setzen(&app, &admin, einsatz, id, "beobachter").await;
    let frieda = login_cookie(&app, "frieda", "friedapw1").await;
    let pfad = format!("{}/lage/fs", basis(einsatz));
    let (status, _) = senden(
        &app,
        &admin,
        "PUT",
        &pfad,
        Some(json!({"x": 8, "y": 8, "version": null})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = senden(&app, &frieda, "DELETE", &pfad, Some(json!({"version": 1}))).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(
        skizze(&app, &admin, einsatz).await["lage"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

// ---------- Schriftfeld ----------

#[tokio::test]
async fn schriftfeld_tri_state_und_zeiten() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen_mit(&app, &admin, "Hochwasser Elbe").await;
    let pfad = format!("{}/schriftfeld", basis(einsatz));

    let (status, json) = senden(
        &app,
        &admin,
        "PUT",
        &pfad,
        Some(json!({"gueltig_ab": "2026-10-04T18:00:00Z", "vs_vermerk": "vs_nfd"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(
        json,
        json!({"herausgeber": null, "vs_vermerk": "vs_nfd",
               "gueltig_ab": "2026-10-04 18:00:00", "gez_name": null, "gez_at": null})
    );
    let (_, json) = senden(
        &app,
        &admin,
        "PUT",
        &pfad,
        Some(
            json!({"herausgeber": " TEL Landkreis ", "gez_name": "M. Muster",
                    "gez_at": "2026-10-04 18:05"}),
        ),
    )
    .await;
    assert_eq!(json["herausgeber"], "TEL Landkreis");
    assert_eq!(
        json["gueltig_ab"], "2026-10-04 18:00:00",
        "fehlend = unverändert"
    );
    assert_eq!(json["gez_at"], "2026-10-04 18:05:00");
    // null leert. Der Server liefert nur den gespeicherten Wert (Review O1): die Vorgabe
    // „Einsatzbezeichnung“ setzt erst die Darstellung ein, sonst sähe das Paneel nie „Vorgabe:“
    // und Rückgängig speicherte die Einsatzbezeichnung statt der Leere.
    let (_, json) = senden(
        &app,
        &admin,
        "PUT",
        &pfad,
        Some(json!({"herausgeber": null, "gueltig_ab": null})),
    )
    .await;
    assert_eq!(json["herausgeber"], Value::Null);
    assert_eq!(json["gueltig_ab"], Value::Null);
    assert_eq!(json["gez_name"], "M. Muster");
    assert_eq!(skizze(&app, &admin, einsatz).await["schriftfeld"], json);

    for body in [
        json!({"vs_vermerk": "geheim"}),
        json!({"vs_vermerk": null}),
        json!({"gueltig_ab": "morgen"}),
        json!({"gez_name": "x".repeat(101)}),
        json!({}),
    ] {
        let (status, _) = senden(&app, &admin, "PUT", &pfad, Some(body.clone())).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    }
}

// ---------- Komponenten ----------

#[tokio::test]
async fn repeater_zwischen_zwei_dmo_gruppen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let anderer = einsatz_anlegen(&app, &admin).await;
    let dmo314 = lokale_sprechgruppe(&app, &admin, einsatz, "314_F*", "DMO").await;
    let dmo315 = lokale_sprechgruppe(&app, &admin, einsatz, "315_F*", "DMO").await;
    let fremd = lokale_sprechgruppe(&app, &admin, anderer, "999", "DMO").await;
    let k = komponente(
        &app,
        &admin,
        einsatz,
        json!({"art": "repeater", "bezeichnung": " RP 1 "}),
    )
    .await;
    assert_eq!(k["art"], "repeater");
    assert_eq!(k["bezeichnung"], "RP 1");
    assert_eq!(k["sprechgruppen"], json!([]));
    let kid = k["id"].as_i64().unwrap();
    let kanal = |sg: i64| format!("{}/komponenten/{kid}/sprechgruppen/{sg}", basis(einsatz));

    for sg in [dmo314, dmo315, dmo314] {
        let (status, _) = senden(&app, &admin, "PUT", &kanal(sg), None).await;
        assert_eq!(status, StatusCode::NO_CONTENT, "idempotent");
    }
    let (status, _) = senden(&app, &admin, "PUT", &kanal(fremd), None).await;
    assert_eq!(
        status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "fremde Sprechgruppe"
    );
    let s = skizze(&app, &admin, einsatz).await;
    let namen: Vec<&str> = s["komponenten"][0]["sprechgruppen"]
        .as_array()
        .unwrap()
        .iter()
        .map(|g| g["bezeichnung"].as_str().unwrap())
        .collect();
    assert_eq!(namen, ["314_F*", "315_F*"]);

    for _ in 0..2 {
        let (status, _) = senden(&app, &admin, "DELETE", &kanal(dmo315), None).await;
        assert_eq!(status, StatusCode::NO_CONTENT, "lösen ist idempotent");
    }
    let s = skizze(&app, &admin, einsatz).await;
    assert_eq!(
        s["komponenten"][0]["sprechgruppen"]
            .as_array()
            .unwrap()
            .len(),
        1
    );

    // PATCH: Art und Bezeichnung (null leert), unbekannte Art 400.
    let pfad = format!("{}/komponenten/{kid}", basis(einsatz));
    let (status, json) = senden(
        &app,
        &admin,
        "PATCH",
        &pfad,
        Some(json!({"art": "gateway", "bezeichnung": null})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(json["art"], "gateway");
    assert_eq!(json["bezeichnung"], Value::Null);
    assert_eq!(json["sprechgruppen"].as_array().unwrap().len(), 1);
    for body in [
        json!({"art": "funkturm"}),
        json!({"bezeichnung": "x".repeat(101)}),
        json!({}),
    ] {
        let (status, _) = senden(&app, &admin, "PATCH", &pfad, Some(body.clone())).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    }
    let (status, _) = senden(
        &app,
        &admin,
        "POST",
        &format!("{}/komponenten", basis(einsatz)),
        Some(json!({"art": "funkturm"})),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // Fremde Komponente: 404.
    let (status, _) = senden(
        &app,
        &admin,
        "PATCH",
        &format!("{}/komponenten/{kid}", basis(anderer)),
        Some(json!({"art": "antenne"})),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let (status, _) = senden(&app, &admin, "DELETE", &pfad, None).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, _) = senden(&app, &admin, "DELETE", &pfad, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(
        skizze(&app, &admin, einsatz).await["komponenten"],
        json!([])
    );
}

// ---------- Verbindungen ----------

#[tokio::test]
async fn melder_als_uebergang_und_validierung() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let anderer = einsatz_anlegen(&app, &admin).await;
    let ea2 = abschnitt(&app, &admin, einsatz, "EA 2").await;
    let marsch = stelle(
        &app,
        &admin,
        einsatz,
        json!({"stellenart": "sonstige", "bezeichnung": "Einheit auf dem Marsch"}),
    )
    .await;
    let s2 = stelle(
        &app,
        &admin,
        einsatz,
        json!({"stellenart": "funktion", "funktion": "s2"}),
    )
    .await;
    let fremd_ab = abschnitt(&app, &admin, anderer, "Fremd").await;

    let v = verbindung(
        &app,
        &admin,
        einsatz,
        json!({"von": {"art": "abschnitt", "id": ea2}, "nach": {"art": "stelle", "id": marsch},
               "art": "melder", "medium": "leitung", "status": "bestehend",
               "hinweis": "  zu Fuß  "}),
    )
    .await;
    assert_eq!(
        v,
        json!({"id": v["id"], "von": {"art": "abschnitt", "id": ea2},
               "nach": {"art": "stelle", "id": marsch}, "art": "melder", "medium": "leitung",
               "status": "bestehend", "verkehr": null, "hinweis": "zu Fuß"})
    );
    let vid = v["id"].as_i64().unwrap();
    let b = basis(einsatz);

    let gueltig = |von: Value, nach: Value| json!({"von": von, "nach": nach, "art": "daten", "medium": "funk", "status": "geplant"});
    let fs = json!({"art": "fuehrungsstelle", "id": null});
    // 400: Feld für sich.
    for body in [
        json!({"von": fs, "nach": {"art": "abschnitt", "id": ea2}, "art": "brieftaube",
               "medium": "funk", "status": "geplant"}),
        json!({"von": fs, "nach": {"art": "abschnitt", "id": ea2}, "art": "daten",
               "medium": "kabel", "status": "geplant"}),
        json!({"von": fs, "nach": {"art": "abschnitt", "id": ea2}, "art": "daten",
               "medium": "funk", "status": "vielleicht"}),
        json!({"von": fs, "nach": {"art": "abschnitt", "id": ea2}, "art": "daten",
               "medium": "funk", "status": "geplant", "verkehr": "simplex"}),
        json!({"von": fs, "nach": {"art": "abschnitt", "id": ea2}, "art": "daten",
               "medium": "funk", "status": "geplant", "hinweis": "x".repeat(201)}),
        gueltig(json!({"art": "fahrzeug", "id": 1}), fs.clone()),
        json!({"von": fs, "nach": {"art": "abschnitt", "id": ea2}, "art": "daten",
               "medium": "funk", "status": "geplant", "rufnummer": "0170"}),
    ] {
        let (status, _) = senden(
            &app,
            &admin,
            "POST",
            &format!("{b}/verbindungen"),
            Some(body.clone()),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    }
    // 422: Zusammenhang.
    for body in [
        gueltig(fs.clone(), fs.clone()),
        gueltig(
            json!({"art": "abschnitt", "id": ea2}),
            json!({"art": "abschnitt", "id": ea2}),
        ),
        gueltig(fs.clone(), json!({"art": "abschnitt", "id": fremd_ab})),
        gueltig(fs.clone(), json!({"art": "einheit", "id": 999_999})),
        gueltig(fs.clone(), json!({"art": "stelle", "id": s2})),
        gueltig(fs.clone(), json!({"art": "abschnitt", "id": null})),
        gueltig(
            json!({"art": "fuehrungsstelle", "id": 5}),
            json!({"art": "abschnitt", "id": ea2}),
        ),
    ] {
        let (status, json) = senden(
            &app,
            &admin,
            "POST",
            &format!("{b}/verbindungen"),
            Some(body.clone()),
        )
        .await;
        assert_eq!(
            status,
            StatusCode::UNPROCESSABLE_ENTITY,
            "{body} → {json:?}"
        );
    }
    assert_eq!(
        skizze(&app, &admin, einsatz).await["verbindungen"]
            .as_array()
            .unwrap()
            .len(),
        1,
        "nichts gespeichert"
    );

    // PATCH ohne von/nach.
    let pfad = format!("{b}/verbindungen/{vid}");
    let (status, json) = senden(
        &app,
        &admin,
        "PATCH",
        &pfad,
        Some(json!({"status": "geplant", "verkehr": "gegen", "hinweis": null, "medium": "funk"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(json["status"], "geplant");
    assert_eq!(json["verkehr"], "gegen");
    assert_eq!(json["medium"], "funk");
    assert_eq!(json["hinweis"], Value::Null);
    assert_eq!(json["art"], "melder", "unverändert");
    let (_, json) = senden(&app, &admin, "PATCH", &pfad, Some(json!({"verkehr": null}))).await;
    assert_eq!(json["verkehr"], Value::Null);
    for body in [
        json!({"von": {"art": "fuehrungsstelle", "id": null}}),
        json!({"art": "brieftaube"}),
        json!({}),
    ] {
        let (status, _) = senden(&app, &admin, "PATCH", &pfad, Some(body.clone())).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    }
    let (status, _) = senden(
        &app,
        &admin,
        "PATCH",
        &format!("{}/verbindungen/{vid}", basis(anderer)),
        Some(json!({"status": "bestehend"})),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = senden(&app, &admin, "DELETE", &pfad, None).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, _) = senden(&app, &admin, "DELETE", &pfad, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

// ---------- Bereiche ----------

#[tokio::test]
async fn bereich_aufziehen_mit_version() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let b = basis(einsatz);
    let (status, json) = senden(
        &app,
        &admin,
        "POST",
        &format!("{b}/bereiche"),
        Some(json!({"x": 800, "y": 0, "breite": 240, "hoehe": 320})),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{json:?}");
    assert_eq!(json["bezeichnung"], "Rückwärtiger Bereich", "Vorgabe");
    assert_eq!(json["version"], 1);
    let bid = json["id"].as_i64().unwrap();
    let pfad = format!("{b}/bereiche/{bid}");

    let (status, json) = senden(
        &app,
        &admin,
        "PATCH",
        &pfad,
        Some(json!({"breite": 320, "hoehe": 400, "version": 1})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(json["breite"], 320.0);
    assert_eq!(json["x"], 800.0, "unverändert");
    assert_eq!(json["version"], 2);
    let (status, json) = senden(
        &app,
        &admin,
        "PATCH",
        &pfad,
        Some(json!({"x": 0, "version": 1})),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(json["aktuell"]["breite"], 320.0);
    for body in [
        json!({"breite": 0, "version": 2}),
        json!({"bezeichnung": "  ", "version": 2}),
        json!({"x": 1}),
    ] {
        let (status, _) = senden(&app, &admin, "PATCH", &pfad, Some(body.clone())).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    }
    for body in [
        json!({"x": 0, "y": 0, "breite": -1, "hoehe": 10}),
        json!({"x": 0, "y": 0, "breite": 10}),
        json!({"x": 0, "y": 0, "breite": 10, "hoehe": 10, "bezeichnung": "x".repeat(101)}),
    ] {
        let (status, _) = senden(
            &app,
            &admin,
            "POST",
            &format!("{b}/bereiche"),
            Some(body.clone()),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    }
    let (status, json) = senden(
        &app,
        &admin,
        "PATCH",
        &pfad,
        Some(json!({"bezeichnung": "Bereitstellungsraum", "version": 2})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["bezeichnung"], "Bereitstellungsraum");
    let (status, _) = senden(&app, &admin, "DELETE", &pfad, None).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(skizze(&app, &admin, einsatz).await["bereiche"], json!([]));
}

// ---------- Live, ETB, Lebenszyklus ----------

#[tokio::test]
async fn jede_skizzenaenderung_sendet_stab_und_nie_etb() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let sg = lokale_sprechgruppe(&app, &admin, einsatz, "311", "TMO").await;
    let vor = system_etb_anzahl(&app, &admin, einsatz).await;
    let b = basis(einsatz);
    let mut rx = live.abonniere(einsatz);

    // Zehn Verschiebungen.
    let mut version: Option<i64> = None;
    for i in 0..10 {
        let (status, json) = senden(
            &app,
            &admin,
            "PUT",
            &format!("{b}/lage/fs"),
            Some(json!({"x": i * 8, "y": 0, "version": version})),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        version = json["version"].as_i64();
    }
    let k = komponente(&app, &admin, einsatz, json!({"art": "antenne"})).await;
    let kid = k["id"].as_i64().unwrap();
    senden(
        &app,
        &admin,
        "PUT",
        &format!("{b}/komponenten/{kid}/sprechgruppen/{sg}"),
        None,
    )
    .await;
    let v = verbindung(
        &app,
        &admin,
        einsatz,
        json!({"von": {"art": "fuehrungsstelle", "id": null}, "nach": {"art": "komponente", "id": kid},
               "art": "daten", "medium": "leitung", "status": "geplant"}),
    )
    .await;
    senden(
        &app,
        &admin,
        "PUT",
        &format!("{b}/schriftfeld"),
        Some(json!({"gez_name": "M. Muster"})),
    )
    .await;
    senden(
        &app,
        &admin,
        "DELETE",
        &format!("{b}/verbindungen/{}", v["id"]),
        None,
    )
    .await;
    senden(&app, &admin, "DELETE", &format!("{b}/lage"), None).await;
    assert_eq!(
        zaehle(&mut rx),
        (16, 0),
        "16 Schreibaktionen, 16 × stab, kein etb"
    );
    assert_eq!(
        system_etb_anzahl(&app, &admin, einsatz).await,
        vor,
        "kein ETB"
    );

    // Abgelehnte Aktionen senden nichts.
    let mut rx = live.abonniere(einsatz);
    senden(
        &app,
        &admin,
        "POST",
        &format!("{b}/komponenten"),
        Some(json!({"art": "funkturm"})),
    )
    .await;
    senden(
        &app,
        &admin,
        "PUT",
        &format!("{b}/lage/fs"),
        Some(json!({"x": 0, "y": 0, "version": 99})),
    )
    .await;
    assert_eq!(zaehle(&mut rx), (0, 0));
}

#[tokio::test]
async fn abgeschlossener_einsatz_ist_409_und_bleibt_lesbar() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    komponente(&app, &admin, einsatz, json!({"art": "antenne"})).await;
    anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschliessen"),
        &admin,
        None,
    )
    .await;
    let (status, _) = senden(
        &app,
        &admin,
        "POST",
        &format!("{}/komponenten", basis(einsatz)),
        Some(json!({"art": "antenne"})),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(
        skizze(&app, &admin, einsatz).await["komponenten"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

// ---------- Bezüge verwaisen nicht ----------

async fn lage_setzen(app: &axum::Router, cookie: &str, einsatz: i64, element: &str) {
    let (status, json) = senden(
        app,
        cookie,
        "PUT",
        &format!("{}/lage/{element}", basis(einsatz)),
        Some(json!({"x": 8, "y": 8, "version": null})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{element}: {json:?}");
}

fn bezieht_sich_auf(s: &Value, art: &str, id: i64, element: &str) -> bool {
    let in_lage = s["lage"]
        .as_array()
        .unwrap()
        .iter()
        .any(|l| l["element"] == element);
    let in_verbindung = s["verbindungen"].as_array().unwrap().iter().any(|v| {
        (v["von"]["art"] == art && v["von"]["id"] == id)
            || (v["nach"]["art"] == art && v["nach"]["id"] == id)
    });
    in_lage || in_verbindung
}

#[tokio::test]
async fn einheit_geloescht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let zug = einheit_bilden(&app, &admin, einsatz, "1. Zug").await;
    let zug2 = einheit_bilden(&app, &admin, einsatz, "2. Zug").await;
    lage_setzen(&app, &admin, einsatz, &format!("eh-{zug}")).await;
    lage_setzen(&app, &admin, einsatz, &format!("eh-{zug2}")).await;
    verbindung(
        &app,
        &admin,
        einsatz,
        json!({"von": {"art": "fuehrungsstelle", "id": null}, "nach": {"art": "einheit", "id": zug},
               "art": "melder", "medium": "leitung", "status": "bestehend"}),
    )
    .await;
    verbindung(
        &app,
        &admin,
        einsatz,
        json!({"von": {"art": "einheit", "id": zug2}, "nach": {"art": "fuehrungsstelle", "id": null},
               "art": "telefon", "medium": "leitung", "status": "bestehend"}),
    )
    .await;

    let (status, _) = anfrage(
        &app,
        "DELETE",
        &format!("/api/einsaetze/{einsatz}/einheiten/{zug}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let s = skizze(&app, &admin, einsatz).await;
    assert!(
        !bezieht_sich_auf(&s, "einheit", zug, &format!("eh-{zug}")),
        "{s:?}"
    );
    assert!(
        bezieht_sich_auf(&s, "einheit", zug2, &format!("eh-{zug2}")),
        "der Nachbar bleibt: {s:?}"
    );
    assert_eq!(s["verbindungen"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn abschnitt_stelle_und_komponente_geloescht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let ab = abschnitt(&app, &admin, einsatz, "EA 1").await;
    let ils = stelle(
        &app,
        &admin,
        einsatz,
        json!({"stellenart": "leitstelle", "bezeichnung": "ILS"}),
    )
    .await;
    let k = komponente(&app, &admin, einsatz, json!({"art": "gateway"})).await;
    let kid = k["id"].as_i64().unwrap();
    for e in [format!("ab-{ab}"), format!("ks-{ils}"), format!("ko-{kid}")] {
        lage_setzen(&app, &admin, einsatz, &e).await;
    }
    for (von, nach) in [
        (
            json!({"art": "abschnitt", "id": ab}),
            json!({"art": "stelle", "id": ils}),
        ),
        (
            json!({"art": "stelle", "id": ils}),
            json!({"art": "komponente", "id": kid}),
        ),
        (
            json!({"art": "komponente", "id": kid}),
            json!({"art": "abschnitt", "id": ab}),
        ),
    ] {
        verbindung(
            &app,
            &admin,
            einsatz,
            json!({"von": von, "nach": nach, "art": "daten", "medium": "leitung", "status": "bestehend"}),
        )
        .await;
    }

    let (status, _) = anfrage(
        &app,
        "DELETE",
        &format!("/api/einsaetze/{einsatz}/abschnitte/{ab}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let s = skizze(&app, &admin, einsatz).await;
    assert!(!bezieht_sich_auf(&s, "abschnitt", ab, &format!("ab-{ab}")));
    assert_eq!(s["verbindungen"].as_array().unwrap().len(), 1);

    let (status, _) = anfrage(
        &app,
        "DELETE",
        &format!("/api/einsaetze/{einsatz}/stab/kommunikationsplan/stellen/{ils}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let s = skizze(&app, &admin, einsatz).await;
    assert!(!bezieht_sich_auf(&s, "stelle", ils, &format!("ks-{ils}")));
    assert_eq!(s["verbindungen"], json!([]));

    let (status, _) = senden(
        &app,
        &admin,
        "DELETE",
        &format!("{}/komponenten/{kid}", basis(einsatz)),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let s = skizze(&app, &admin, einsatz).await;
    assert_eq!(s["lage"], json!([]), "{s:?}");
}

// ---------- Schwärzung ----------

#[tokio::test]
async fn schwaerzung_nimmt_namen_und_hinweise_und_behaelt_das_skelett() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let sg = lokale_sprechgruppe(&app, &admin, einsatz, "311", "TMO").await;
    let ils = stelle(
        &app,
        &admin,
        einsatz,
        json!({"stellenart": "leitstelle", "bezeichnung": "ILS"}),
    )
    .await;
    let (status, _) = senden(
        &app,
        &admin,
        "PUT",
        &format!(
            "/api/einsaetze/{einsatz}/stab/kommunikationsplan/stellen/{ils}/sprechgruppen/{sg}"
        ),
        Some(json!({"status": "geplant"})),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let k = komponente(
        &app,
        &admin,
        einsatz,
        json!({"art": "repeater", "bezeichnung": "Repeater Hof Müller"}),
    )
    .await;
    let kid = k["id"].as_i64().unwrap();
    verbindung(
        &app,
        &admin,
        einsatz,
        json!({"von": {"art": "fuehrungsstelle", "id": null}, "nach": {"art": "komponente", "id": kid},
               "art": "richtfunk", "medium": "funk", "status": "geplant",
               "hinweis": "Mast bei Familie Beispiel"}),
    )
    .await;
    let b = basis(einsatz);
    senden(
        &app,
        &admin,
        "POST",
        &format!("{b}/bereiche"),
        Some(json!({"bezeichnung": "Hof Müller", "x": 1, "y": 2, "breite": 3, "hoehe": 4})),
    )
    .await;
    senden(
        &app,
        &admin,
        "PUT",
        &format!("{b}/schriftfeld"),
        Some(
            json!({"gez_name": "M. Muster", "gez_at": "2026-10-04 18:00", "vs_vermerk": "vs_nfd"}),
        ),
    )
    .await;
    lage_setzen(&app, &admin, einsatz, &format!("ko-{kid}")).await;

    let mut tx = pool.begin().await.unwrap();
    lifeline_hub::einsatz::schwaerzung_registry::scrubbe_aus_registry(
        &mut tx,
        einsatz,
        lifeline_hub::einsatz::schwaerzung_registry::Umfang::Alles,
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();

    let s = skizze(&app, &admin, einsatz).await;
    let k = &s["komponenten"][0];
    assert_eq!(k["art"], "repeater");
    assert_eq!(k["bezeichnung"], Value::Null);
    assert_eq!(k["sprechgruppen"], json!([]));
    let v = &s["verbindungen"][0];
    assert_eq!(
        (
            v["art"].as_str(),
            v["medium"].as_str(),
            v["status"].as_str()
        ),
        (Some("richtfunk"), Some("funk"), Some("geplant"))
    );
    assert_eq!(v["hinweis"], Value::Null);
    let bereich = &s["bereiche"][0];
    assert!(
        !bereich["bezeichnung"].as_str().unwrap().contains("Müller"),
        "{bereich:?}"
    );
    assert_eq!(bereich["breite"], 3.0, "Lage bleibt");
    assert_eq!(s["schriftfeld"]["gez_name"], Value::Null);
    assert_eq!(s["schriftfeld"]["vs_vermerk"], "vs_nfd");
    assert_eq!(s["lage"].as_array().unwrap().len(), 1, "Lage bleibt");
    let status: String = sqlx::query_scalar(
        "SELECT status FROM einsatz_kommunikation_stelle_sprechgruppe WHERE stelle_id = ?",
    )
    .bind(ils)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(status, "geplant", "Status bleibt");
}
