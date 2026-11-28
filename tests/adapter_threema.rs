//! Adapterart `threema` (LLH-2096): Einstellungen, eine Anbindung je Org, privater Schlüssel.

use axum::http::StatusCode;
use serde_json::{json, Value};

mod adapter_testart;
mod common;
use common::{anfrage_json, login_cookie, setup_mit_state};

const LISTE: &str = "/api/admin/adapter";

async fn setup() -> (axum::Router, String) {
    let rahmen = adapter_testart::rahmen_threema();
    let (app, _pool) = setup_mit_state(|s| s.adapter = rahmen).await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    (app, admin)
}

async fn anlegen(app: &axum::Router, admin: &str, gateway_id: &str) -> (StatusCode, Value) {
    let body = json!({
        "art": "threema",
        "name": "Threema",
        "einstellungen": { "gateway_id": gateway_id },
    });
    anfrage_json(app, "POST", LISTE, admin, Some(&body)).await
}

#[tokio::test]
async fn zweite_threema_anbindung_ist_422() {
    let (app, admin) = setup().await;
    let (s, a) = anlegen(&app, &admin, "*LAGE123").await;
    assert_eq!(s, StatusCode::CREATED, "{a}");
    let (s, a) = anlegen(&app, &admin, "*LAGE124").await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{a}");
    assert!(a.to_string().contains("Threema-Anbindung"), "{a}");
}

#[tokio::test]
async fn gateway_id_muss_stern_und_sieben_zeichen_sein() {
    let (app, admin) = setup().await;
    for falsch in ["LAGE1234", "*lage123", "*LAG"] {
        let (s, a) = anlegen(&app, &admin, falsch).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{falsch}: {a}");
    }
}

#[tokio::test]
async fn privater_schluessel_wird_beim_setzen_geprueft() {
    let (app, admin) = setup().await;
    let (_, a) = anlegen(&app, &admin, "*LAGE123").await;
    let id = a["id"].as_str().unwrap();
    let pfad = format!("{LISTE}/{id}/secrets/privater_schluessel");
    let (s, v) = anfrage_json(
        &app,
        "PUT",
        &pfad,
        &admin,
        Some(&json!({ "wert": "ab".repeat(31) + "a" })),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{v}");
    assert!(v.to_string().contains("64 Hex-Zeichen"), "{v}");
    let (s, v) = anfrage_json(
        &app,
        "PUT",
        &pfad,
        &admin,
        Some(&json!({ "wert": format!("private:{}\n", "AB".repeat(32)) })),
    )
    .await;
    assert!(s.is_success(), "{s}: {v}");
}

#[tokio::test]
async fn pruefung_liefert_das_guthaben_als_anzahl() {
    let (app, admin) = setup().await;
    let (_, a) = anlegen(&app, &admin, "*LAGE123").await;
    let id = a["id"].as_str().unwrap();
    for (platz, wert) in [
        ("secret", "geheim".to_string()),
        ("privater_schluessel", "ab".repeat(32)),
    ] {
        let (s, _) = anfrage_json(
            &app,
            "PUT",
            &format!("{LISTE}/{id}/secrets/{platz}"),
            &admin,
            Some(&json!({ "wert": wert })),
        )
        .await;
        assert!(s.is_success(), "{platz}: {s}");
    }
    let (_, e) = anfrage_json(&app, "POST", &format!("{LISTE}/{id}/check"), &admin, None).await;
    assert_eq!(e["erfolg"], true, "{e}");
    // Die Prüfung von Hand nennt das Guthaben als Anzahl; der regelmäßige Lauf merkt es in
    // `letzte_anzahl`.
    assert_eq!(e["anzahl"], 100, "{e}");
}
