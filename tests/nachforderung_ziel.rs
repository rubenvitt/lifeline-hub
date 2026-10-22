//! Integrationstests zu LLH-1089: Nachforderung ohne Details, mit Ziel (Bereitstellungsraum,
//! Einsatzabschnitt oder Ort als Freitext) und Bedarfszeit „benötigt bis“. Geprüft wird die
//! Prüfkette beim Anlegen (400 → 422 → 403 → 404 → 409, design.md D8) und dass Ziel und
//! Bedarfszeit in Anzeige und ETB ankommen.
//!
//! Die Spalten prüft `db::tests::migration_0235_*`, den ETB-Wortlaut `nachforderung::repo`.

use axum::http::StatusCode;
use serde_json::{json, Value};

mod common;
use common::*;

fn nachforderungen(einsatz: i64) -> String {
    format!("/api/einsaetze/{einsatz}/nachforderungen")
}

/// „2× RTW“ an die Leitstelle, ergänzt um `extra`.
async fn anlegen(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    extra: Value,
) -> (StatusCode, Value) {
    let mut body = json!({ "art": "RTW", "anzahl": 2, "adressat_kategorie": "leitstelle" });
    for (k, v) in extra.as_object().unwrap() {
        body[k] = v.clone();
    }
    anfrage(
        app,
        "POST",
        &nachforderungen(einsatz),
        cookie,
        Some(&body.to_string()),
    )
    .await
}

async fn liste(app: &axum::Router, cookie: &str, einsatz: i64) -> Vec<Value> {
    let (s, j) = anfrage(app, "GET", &nachforderungen(einsatz), cookie, None).await;
    assert_eq!(s, StatusCode::OK, "{j:?}");
    j.as_array().unwrap().clone()
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
    j["id"].as_i64().unwrap()
}

async fn raum_status(app: &axum::Router, cookie: &str, einsatz: i64, br: i64, status: &str) {
    let (s, j) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/bereitstellungsraeume/{br}/status"),
        cookie,
        Some(&json!({ "status": status }).to_string()),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "Status {status}: {j:?}");
}

async fn abschnitt(app: &axum::Router, cookie: &str, einsatz: i64, name: &str) -> i64 {
    let (s, j) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschnitte"),
        cookie,
        Some(&json!({ "name": name }).to_string()),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "Abschnitt: {j:?}");
    j["id"].as_i64().unwrap()
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

/// Eine Führungskraft im Einsatz (Schreibrecht, kein Admin — Admins sehen jedes Modul).
async fn fuehrung(app: &axum::Router, admin: &str, einsatz: i64, name: &str) -> String {
    let id = benutzer_anlegen(app, admin, name, "keine").await;
    rolle_setzen(app, admin, einsatz, id, "fuehrungspersonal").await;
    login_cookie(app, name, &format!("{name}pw1")).await
}

/// Der Inhalt des ETB-Eintrags der Anlage.
async fn etb_inhalt(app: &axum::Router, cookie: &str, einsatz: i64, n: &Value) -> String {
    let etb_id = n["etb_nachforderung_id"].as_i64().unwrap();
    let (s, etb) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/etb"),
        cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{etb:?}");
    etb.as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"] == etb_id)
        .expect("Eintrag der Anlage")["inhalt"]
        .as_str()
        .unwrap()
        .to_string()
}

#[tokio::test]
async fn ohne_details_ist_die_nachforderung_gueltig() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    for extra in [
        json!({}),
        json!({ "bezeichnung": "  " }),
        json!({ "bezeichnung": null }),
    ] {
        let (s, n) = anlegen(&app, &admin, e, extra.clone()).await;
        assert_eq!(s, StatusCode::CREATED, "{extra}: {n:?}");
        let o = n.as_object().unwrap();
        for feld in [
            "bezeichnung",
            "ziel_br_id",
            "ziel_abschnitt_id",
            "ziel_text",
            "benoetigt_bis",
        ] {
            assert!(!o.contains_key(feld), "{feld} fehlt ohne Wert: {n:?}");
        }
        assert_eq!(
            etb_inhalt(&app, &admin, e, &n).await,
            "Nachforderung: 2× RTW"
        );
    }
}

#[tokio::test]
async fn ziel_bereitstellungsraum_und_bedarfszeit_kommen_in_anzeige_und_etb() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let br = raum(&app, &admin, e, "BR Nord").await;
    let (s, n) = anlegen(
        &app,
        &admin,
        e,
        json!({
            "ziel_br_id": br,
            "bezeichnung": "Transport aus UHS Turnhalle",
            "angefordert_at": "2026-10-21 12:00:00",
            "benoetigt_bis": "2026-10-21T13:30"
        }),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{n:?}");
    assert_eq!(n["ziel_br_id"], br);
    assert_eq!(n["benoetigt_bis"], "2026-10-21 13:30:00", "normalisiert");
    // Nur die Kennung, kein Name des Raums (design.md D10).
    assert!(n.get("ziel_name").is_none());
    assert_eq!(
        etb_inhalt(&app, &admin, e, &n).await,
        "Nachforderung: 2× RTW → BR Nord, benötigt bis 21.10. 15:30 — Transport aus UHS Turnhalle"
    );
    assert_eq!(liste(&app, &admin, e).await[0]["ziel_br_id"], br);
}

#[tokio::test]
async fn ziel_abschnitt_und_freitext() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let a = abschnitt(&app, &admin, e, "EA Deich").await;
    let (s, n) = anlegen(&app, &admin, e, json!({ "ziel_abschnitt_id": a })).await;
    assert_eq!(s, StatusCode::CREATED, "{n:?}");
    assert_eq!(n["ziel_abschnitt_id"], a);
    assert_eq!(
        etb_inhalt(&app, &admin, e, &n).await,
        "Nachforderung: 2× RTW → EA Deich"
    );

    let (s, n) = anlegen(
        &app,
        &admin,
        e,
        json!({ "ziel_text": "  Lotsenpunkt Feuerwache " }),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{n:?}");
    assert_eq!(n["ziel_text"], "Lotsenpunkt Feuerwache");
    assert_eq!(
        etb_inhalt(&app, &admin, e, &n).await,
        "Nachforderung: 2× RTW → Lotsenpunkt Feuerwache"
    );
}

/// 400 vor 422: das Feld für sich vor dem Zusammenhang.
#[tokio::test]
async fn feldfehler_sind_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let br = raum(&app, &admin, e, "BR Nord").await;
    let fall = [
        json!({ "ziel_text": "x".repeat(201) }),
        json!({ "bezeichnung": "x".repeat(201) }),
        json!({ "benoetigt_bis": "morgen früh" }),
        // Zwei Ziele UND ein zu langer Text: der Feldfehler geht vor.
        json!({ "ziel_br_id": br, "ziel_text": "x".repeat(201) }),
        json!({ "ziel_br_id": "BR Nord" }),
    ];
    for extra in fall {
        let (s, j) = anlegen(&app, &admin, e, extra.clone()).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{extra}: {j:?}");
    }
    assert!(liste(&app, &admin, e).await.is_empty(), "nichts angelegt");
}

#[tokio::test]
async fn zusammenhang_ist_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let br = raum(&app, &admin, e, "BR Nord").await;
    let a = abschnitt(&app, &admin, e, "EA Deich").await;
    let fall = [
        json!({ "ziel_br_id": br, "ziel_text": "Zufahrt Süd" }),
        json!({ "ziel_br_id": br, "ziel_abschnitt_id": a }),
        json!({ "ziel_abschnitt_id": a, "ziel_text": "Deich km 3" }),
        json!({ "angefordert_at": "2026-10-21 12:00:00", "benoetigt_bis": "2026-10-21 11:59:00" }),
    ];
    for extra in fall {
        let (s, j) = anlegen(&app, &admin, e, extra.clone()).await;
        assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{extra}: {j:?}");
    }
    // Gleich der Anforderung ist zulässig.
    let (s, j) = anlegen(
        &app,
        &admin,
        e,
        json!({ "angefordert_at": "2026-10-21 12:00:00", "benoetigt_bis": "2026-10-21 12:00:00" }),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{j:?}");
}

#[tokio::test]
async fn fremdes_oder_unbekanntes_ziel_ist_404() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let fremd = einsatz_anlegen(&app, &admin).await;
    let fremder_raum = raum(&app, &admin, fremd, "BR Fremd").await;
    let fremder_abschnitt = abschnitt(&app, &admin, fremd, "EA Fremd").await;
    for extra in [
        json!({ "ziel_br_id": fremder_raum }),
        json!({ "ziel_br_id": 999_999 }),
        json!({ "ziel_abschnitt_id": fremder_abschnitt }),
        json!({ "ziel_abschnitt_id": 999_999 }),
    ] {
        let (s, j) = anlegen(&app, &admin, e, extra.clone()).await;
        assert_eq!(s, StatusCode::NOT_FOUND, "{extra}: {j:?}");
    }
    assert!(liste(&app, &admin, e).await.is_empty(), "nichts angelegt");
}

#[tokio::test]
async fn aufgeloester_oder_stornierter_raum_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let aufgeloest = raum(&app, &admin, e, "BR Alt").await;
    raum_status(&app, &admin, e, aufgeloest, "aufgeloest").await;
    let storniert = raum(&app, &admin, e, "BR Fehlanlage").await;
    let (s, j) = anfrage(
        &app,
        "DELETE",
        &format!("/api/einsaetze/{e}/bereitstellungsraeume/{storniert}"),
        &admin,
        None,
    )
    .await;
    assert!(s.is_success(), "Storno: {j:?}");
    for br in [aufgeloest, storniert] {
        let (s, j) = anlegen(&app, &admin, e, json!({ "ziel_br_id": br })).await;
        assert_eq!(s, StatusCode::CONFLICT, "Raum {br}: {j:?}");
    }
    // Ein geplanter Raum ist ein gültiges Ziel.
    let geplant = raum(&app, &admin, e, "BR Süd").await;
    let (s, j) = anlegen(&app, &admin, e, json!({ "ziel_br_id": geplant })).await;
    assert_eq!(s, StatusCode::CREATED, "{j:?}");
}

/// Ohne Lesezugriff auf das Modul des Ziels: 403, auch für ein Ziel, das es nicht gibt. Ohne
/// Ziel und mit Freitext bleibt das Anlegen möglich.
#[tokio::test]
async fn ohne_recht_am_modul_des_ziels_ist_403() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let br = raum(&app, &admin, e, "BR Nord").await;
    let a = abschnitt(&app, &admin, e, "EA Deich").await;
    let frieda = fuehrung(&app, &admin, e, "frieda").await;
    modul_ausblenden(&app, &admin, e, "bereitstellungsraeume").await;
    modul_ausblenden(&app, &admin, e, "einsatzabschnitte").await;

    for extra in [
        json!({ "ziel_br_id": br }),
        json!({ "ziel_br_id": 999_999 }),
        json!({ "ziel_abschnitt_id": a }),
        json!({ "ziel_abschnitt_id": 999_999 }),
    ] {
        let (s, j) = anlegen(&app, &frieda, e, extra.clone()).await;
        assert_eq!(s, StatusCode::FORBIDDEN, "{extra}: {j:?}");
    }
    assert!(liste(&app, &frieda, e).await.is_empty());
    for extra in [json!({}), json!({ "ziel_text": "BR Nord" })] {
        let (s, j) = anlegen(&app, &frieda, e, extra.clone()).await;
        assert_eq!(s, StatusCode::CREATED, "{extra}: {j:?}");
    }
}
