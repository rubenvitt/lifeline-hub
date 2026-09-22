//! Rückmeldung je Einheit/Abschnitt (LFH-610): strukturierter Absender an der Meldung,
//! letzte Rückmeldung je Bezug und Fälligkeit aus der Rückmeldefrist.
use axum::http::StatusCode;
use serde_json::{json, Value};

mod common;
use common::{anfrage, einsatz_anlegen, login_cookie, setup};

async fn einheit_bilden(app: &axum::Router, cookie: &str, einsatz: i64, name: &str) -> i64 {
    let (s, json) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/einheiten"),
        cookie,
        Some(&json!({ "name": name }).to_string()),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{json:?}");
    json["id"].as_i64().unwrap()
}

async fn abschnitt_anlegen(app: &axum::Router, cookie: &str, einsatz: i64, name: &str) -> i64 {
    let (s, json) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschnitte"),
        cookie,
        Some(&json!({ "name": name }).to_string()),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{json:?}");
    json["id"].as_i64().unwrap()
}

/// Meldung mit optionalem Bezug; liefert (Status, Antwort).
async fn melden(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    inhalt: &str,
    ereigniszeit: &str,
    bezug: Value,
) -> (StatusCode, Value) {
    let mut body = json!({
        "absender": "Florian Nord 1",
        "meldeweg": "funk",
        "inhalt": inhalt,
        "ereigniszeit": ereigniszeit,
    });
    for (k, v) in bezug.as_object().unwrap() {
        body[k] = v.clone();
    }
    anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/meldungen"),
        cookie,
        Some(&body.to_string()),
    )
    .await
}

async fn rueckmeldungen(app: &axum::Router, cookie: &str, einsatz: i64) -> Value {
    let (s, json) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/meldungen/rueckmeldungen"),
        cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{json:?}");
    json
}

#[tokio::test]
async fn meldung_traegt_einheit_und_ohne_bezug_keinen_schluessel() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let einheit = einheit_bilden(&app, &admin, e, "1. Zug").await;

    let (s, m) = melden(
        &app,
        &admin,
        e,
        "Lage ruhig",
        "2026-09-22 14:00:00",
        json!({ "einheit_id": einheit }),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{m:?}");
    assert_eq!(m["einheit_id"], einheit);
    assert!(!m.as_object().unwrap().contains_key("abschnitt_id"));

    // Ohne Bezug: Schlüssel fehlen (skip_serializing_if), statt `null` zu tragen.
    let (_, ohne) = melden(&app, &admin, e, "x", "2026-09-22 14:00:00", json!({})).await;
    let o = ohne.as_object().unwrap();
    assert!(!o.contains_key("einheit_id"));
    assert!(!o.contains_key("abschnitt_id"));
}

#[tokio::test]
async fn einheit_und_abschnitt_zugleich_ist_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let einheit = einheit_bilden(&app, &admin, e, "1. Zug").await;
    let abschnitt = abschnitt_anlegen(&app, &admin, e, "Nord").await;

    let (s, _) = melden(
        &app,
        &admin,
        e,
        "x",
        "2026-09-22 14:00:00",
        json!({ "einheit_id": einheit, "abschnitt_id": abschnitt }),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn unbekannter_oder_fremder_bezug_wird_herabgestuft_statt_abgelehnt() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e1 = einsatz_anlegen(&app, &admin).await;
    let e2 = einsatz_anlegen(&app, &admin).await;
    let fremde_einheit = einheit_bilden(&app, &admin, e2, "Fremd").await;
    let fremder_abschnitt = abschnitt_anlegen(&app, &admin, e2, "Fremd").await;

    // Offline-Fall: die Einheit wurde bis zum Sync aufgelöst — die Meldung muss trotzdem
    // entstehen (sonst landet sie in den abgelehnten Aktionen), nur ohne Bezug.
    let aufgeloest = einheit_bilden(&app, &admin, e1, "Weg").await;
    let (s, _) = anfrage(
        &app,
        "DELETE",
        &format!("/api/einsaetze/{e1}/einheiten/{aufgeloest}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT);

    for bezug in [
        json!({ "einheit_id": aufgeloest }),
        json!({ "einheit_id": fremde_einheit }),
        json!({ "abschnitt_id": fremder_abschnitt }),
        json!({ "einheit_id": 999_999 }),
    ] {
        let (s, m) = melden(&app, &admin, e1, "x", "2026-09-22 14:00:00", bezug.clone()).await;
        assert_eq!(s, StatusCode::CREATED, "{bezug}");
        let o = m.as_object().unwrap();
        assert!(!o.contains_key("einheit_id"), "{bezug}");
        assert!(!o.contains_key("abschnitt_id"), "{bezug}");
        assert_eq!(
            m["absender"], "Florian Nord 1",
            "Freitext trägt den Namen weiter"
        );
    }
    let r = rueckmeldungen(&app, &admin, e2).await;
    assert!(
        r["einheiten"].as_array().unwrap().is_empty()
            && r["abschnitte"].as_array().unwrap().is_empty(),
        "nichts landet im fremden Einsatz"
    );
}

#[tokio::test]
async fn nicht_numerischer_bezug_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (s, _) = melden(
        &app,
        &admin,
        e,
        "x",
        "2026-09-22 14:00:00",
        json!({ "einheit_id": "zug" }),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn letzte_rueckmeldung_je_einheit_nach_ereigniszeit() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let a = einheit_bilden(&app, &admin, e, "A").await;
    let b = einheit_bilden(&app, &admin, e, "B").await;
    let _still = einheit_bilden(&app, &admin, e, "Still").await;
    let abschnitt = abschnitt_anlegen(&app, &admin, e, "Nord").await;

    let bez_a = json!({ "einheit_id": a });
    melden(
        &app,
        &admin,
        e,
        "A früh",
        "2026-09-22 13:00:00",
        bez_a.clone(),
    )
    .await;
    melden(
        &app,
        &admin,
        e,
        "A spät",
        "2026-09-22 14:11:00",
        bez_a.clone(),
    )
    .await;
    // Nachgetragen: später ERFASST, aber mit älterer Ereigniszeit — zählt nicht als letzte.
    melden(
        &app,
        &admin,
        e,
        "A nachgetragen",
        "2026-09-22 12:00:00",
        bez_a,
    )
    .await;
    melden(
        &app,
        &admin,
        e,
        "B einzige",
        "2026-09-22 13:15:00",
        json!({ "einheit_id": b }),
    )
    .await;
    melden(
        &app,
        &admin,
        e,
        "Abschnitt direkt",
        "2026-09-22 14:05:00",
        json!({ "abschnitt_id": abschnitt }),
    )
    .await;
    // Ohne Bezug: taucht nirgends auf.
    melden(&app, &admin, e, "frei", "2026-09-22 14:30:00", json!({})).await;

    let r = rueckmeldungen(&app, &admin, e).await;
    assert_eq!(r["frist_min"], 60, "Vorgabe ohne Einstellung");
    let einheiten = r["einheiten"].as_array().unwrap();
    assert_eq!(einheiten.len(), 2, "die stille Einheit hat keinen Eintrag");
    let ea = einheiten.iter().find(|x| x["bezug_id"] == a).unwrap();
    assert_eq!(ea["inhalt"], "A spät");
    assert_eq!(ea["ereigniszeit"], "2026-09-22 14:11:00");
    assert_eq!(ea["meldeweg"], "funk");
    assert_eq!(ea["faellig_at"], "2026-09-22 15:11:00");
    let eb = einheiten.iter().find(|x| x["bezug_id"] == b).unwrap();
    assert_eq!(eb["inhalt"], "B einzige");

    let abschnitte = r["abschnitte"].as_array().unwrap();
    assert_eq!(abschnitte.len(), 1);
    assert_eq!(abschnitte[0]["bezug_id"], abschnitt);
    assert_eq!(abschnitte[0]["inhalt"], "Abschnitt direkt");
}

#[tokio::test]
async fn frist_aus_einsatz_einstellung_schlaegt_vorgabe() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let a = einheit_bilden(&app, &admin, e, "A").await;
    let (s, einst) = anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{e}/einstellungen"),
        &admin,
        Some(r#"{"rueckmeldung_frist_min":20}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{einst:?}");
    assert_eq!(einst["rueckmeldung_frist_min"], 20);
    melden(
        &app,
        &admin,
        e,
        "x",
        "2026-09-22 23:50:00",
        json!({ "einheit_id": a }),
    )
    .await;

    let r = rueckmeldungen(&app, &admin, e).await;
    assert_eq!(r["frist_min"], 20);
    assert_eq!(r["einheiten"][0]["faellig_at"], "2026-09-23 00:10:00");
}

#[tokio::test]
async fn ungueltige_rueckmeldefrist_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    for wert in [0, 99_999] {
        let (s, _) = anfrage(
            &app,
            "PUT",
            &format!("/api/einsaetze/{e}/einstellungen"),
            &admin,
            Some(&json!({ "rueckmeldung_frist_min": wert }).to_string()),
        )
        .await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "Frist {wert}");
    }
}

#[tokio::test]
async fn aufgeloeste_einheit_laesst_meldung_stehen_und_verschwindet_aus_rueckmeldungen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let a = einheit_bilden(&app, &admin, e, "A").await;
    let (_, m) = melden(
        &app,
        &admin,
        e,
        "Letzte Worte",
        "2026-09-22 14:00:00",
        json!({ "einheit_id": a }),
    )
    .await;

    let (s, _) = anfrage(
        &app,
        "DELETE",
        &format!("/api/einsaetze/{e}/einheiten/{a}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(
        s,
        StatusCode::NO_CONTENT,
        "Auflösen darf nicht am FK scheitern"
    );

    let (_, liste) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/meldungen"),
        &admin,
        None,
    )
    .await;
    let meldung = liste
        .as_array()
        .unwrap()
        .iter()
        .find(|x| x["id"] == m["id"])
        .expect("Meldung überlebt das Auflösen");
    assert_eq!(meldung["absender"], "Florian Nord 1");
    assert!(!meldung.as_object().unwrap().contains_key("einheit_id"));

    let r = rueckmeldungen(&app, &admin, e).await;
    assert!(r["einheiten"].as_array().unwrap().is_empty());
}

#[tokio::test]
async fn rueckmeldungen_fremder_einsatz_bleiben_getrennt() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e1 = einsatz_anlegen(&app, &admin).await;
    let e2 = einsatz_anlegen(&app, &admin).await;
    let a = einheit_bilden(&app, &admin, e1, "A").await;
    melden(
        &app,
        &admin,
        e1,
        "x",
        "2026-09-22 14:00:00",
        json!({ "einheit_id": a }),
    )
    .await;
    let r = rueckmeldungen(&app, &admin, e2).await;
    assert!(r["einheiten"].as_array().unwrap().is_empty());
}
