//! Adapterart `sipgate_fax` (LLH-2095): Einstellungen, eine Anbindung je Org, Verbindungsprüfung.

use axum::http::StatusCode;
use lifeline_hub::adapter::art::Verzeichnis;
use lifeline_hub::adapter::sipgate::SipgateFehler;
use serde_json::{json, Value};

mod adapter_testart;
mod common;
use common::{anfrage_json, login_cookie, setup_mit_state};

const LISTE: &str = "/api/admin/adapter";

fn einstellungen() -> Value {
    json!({ "token_id": "token-ABC123", "faxline_id": "f0", "absender_kennung": "ELW 1" })
}

async fn setup() -> (
    axum::Router,
    String,
    std::sync::Arc<adapter_testart::SipgateSkript>,
) {
    let (rahmen, pruefer) = adapter_testart::rahmen_sipgate();
    let (app, _pool) = setup_mit_state(|s| s.adapter = rahmen).await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    (app, admin, pruefer)
}

async fn anlegen(app: &axum::Router, admin: &str, e: Value) -> (StatusCode, Value) {
    let body = json!({ "art": "sipgate_fax", "name": "Fax", "einstellungen": e });
    anfrage_json(app, "POST", LISTE, admin, Some(&body)).await
}

#[test]
fn fax_art_ist_im_verzeichnis() {
    let v = Verzeichnis::produktiv(std::sync::Arc::new(lifeline_hub::drohne::Store::new()));
    let art = v.find("sipgate_fax").expect("Art sipgate_fax");
    assert_eq!(art.bezeichnung(), "Fax (sipgate)");
    assert_eq!(art.intervall_min_s(), 900);
    assert_eq!(art.plaetze()[0].name, "token");
    assert!(art.plaetze()[0].pflicht);
}

#[tokio::test]
async fn anlegen_mit_gueltigen_einstellungen_ist_201() {
    let (app, admin, _) = setup().await;
    let (s, a) = anlegen(&app, &admin, einstellungen()).await;
    assert_eq!(s, StatusCode::CREATED, "{a}");
}

#[tokio::test]
async fn faxline_muss_f_und_ziffern_sein() {
    let (app, admin, _) = setup().await;
    for falsch in ["0", "g0", "f", "f0x", "p1"] {
        let mut e = einstellungen();
        e["faxline_id"] = json!(falsch);
        let (s, a) = anlegen(&app, &admin, e).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{falsch}: {a}");
    }
    let mut e = einstellungen();
    e.as_object_mut().unwrap().remove("token_id");
    let (s, _) = anlegen(&app, &admin, e).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn zweite_fax_anbindung_ist_422() {
    let (app, admin, _) = setup().await;
    let (s, a) = anlegen(&app, &admin, einstellungen()).await;
    assert_eq!(s, StatusCode::CREATED, "{a}");
    let (s, e) = anlegen(&app, &admin, einstellungen()).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{e}");
}

#[tokio::test]
async fn probe_prueft_token_und_faxline() {
    let (app, admin, pruefer) = setup().await;
    let (_, a) = anlegen(&app, &admin, einstellungen()).await;
    let id = a["id"].as_str().unwrap();
    let (s, _) = anfrage_json(
        &app,
        "PUT",
        &format!("{LISTE}/{id}/secrets/token"),
        &admin,
        Some(&json!({ "wert": "geheim" })),
    )
    .await;
    assert!(s.is_success(), "{s}");
    let pfad = format!("{LISTE}/{id}/check");

    let (_, e) = anfrage_json(&app, "POST", &pfad, &admin, None).await;
    assert_eq!(e["erfolg"], true, "{e}");
    assert_eq!(
        pruefer.gesehen.lock().unwrap().as_slice(),
        ["token-ABC123 f0 true"]
    );

    pruefer
        .skript
        .lock()
        .unwrap()
        .push_back(Err(SipgateFehler::Status(401)));
    let (_, e) = anfrage_json(&app, "POST", &pfad, &admin, None).await;
    assert_eq!(e["erfolg"], false);
    assert_eq!(e["fehler_art"], "abgelehnt");

    pruefer
        .skript
        .lock()
        .unwrap()
        .push_back(Err(SipgateFehler::FaxlineUnbekannt));
    let (_, e) = anfrage_json(&app, "POST", &pfad, &admin, None).await;
    assert_eq!(e["fehler_art"], "einstellung_ungueltig", "{e}");
}
