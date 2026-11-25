//! Adapterart `smtp` (LLH-2093): Einstellungen, eine Anbindung je Org, Verbindungsprüfung.

use axum::http::StatusCode;
use lifeline_hub::adapter::art::Verzeichnis;
use lifeline_hub::adapter::smtp::SmtpFehler;
use serde_json::{json, Value};

mod adapter_testart;
mod common;
use common::{anfrage_json, login_cookie, setup_mit_state};

const LISTE: &str = "/api/admin/adapter";

fn einstellungen() -> Value {
    json!({
        "host": "mail.example.org",
        "port": 587,
        "verschluesselung": "starttls",
        "benutzer": "versand",
        "absender": "einsatz@example.org",
        "absender_name": "Lifeline Hub"
    })
}

async fn setup() -> (
    axum::Router,
    String,
    std::sync::Arc<adapter_testart::SmtpSkript>,
) {
    let (rahmen, pruefer) = adapter_testart::rahmen_smtp();
    let (app, _pool) = setup_mit_state(|s| s.adapter = rahmen).await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    (app, admin, pruefer)
}

async fn anlegen(app: &axum::Router, admin: &str, e: Value) -> (StatusCode, Value) {
    let body = json!({ "art": "smtp", "name": "Ausgang", "einstellungen": e });
    anfrage_json(app, "POST", LISTE, admin, Some(&body)).await
}

#[test]
fn smtp_art_ist_im_verzeichnis() {
    let v = Verzeichnis::produktiv();
    let art = v.find("smtp").expect("Art smtp");
    assert_eq!(art.bezeichnung(), "E-Mail (SMTP)");
    assert_eq!(art.intervall_min_s(), 900);
    assert_eq!(art.intervall_vorschlag_s(), 3600);
    assert_eq!(art.plaetze()[0].name, "passwort");
    assert!(!art.plaetze()[0].pflicht);
}

#[tokio::test]
async fn anlegen_mit_gueltigen_einstellungen_ist_201() {
    let (app, admin, _) = setup().await;
    let (s, a) = anlegen(&app, &admin, einstellungen()).await;
    assert_eq!(s, StatusCode::CREATED, "{a}");
    assert_eq!(a["intervall_s"], 3600);
}

#[tokio::test]
async fn einstellungen_ohne_absender_sind_400() {
    let (app, admin, _) = setup().await;
    let mut e = einstellungen();
    e.as_object_mut().unwrap().remove("absender");
    let (s, _) = anlegen(&app, &admin, e).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);

    let mut e = einstellungen();
    e["absender"] = json!("keine adresse");
    let (s, _) = anlegen(&app, &admin, e).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn verschluesselung_klartext_ist_400() {
    let (app, admin, _) = setup().await;
    let mut e = einstellungen();
    e["verschluesselung"] = json!("klartext");
    let (s, _) = anlegen(&app, &admin, e).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn port_ausserhalb_des_bereichs_ist_400() {
    let (app, admin, _) = setup().await;
    for port in [0, 70000, -1] {
        let mut e = einstellungen();
        e["port"] = json!(port);
        let (s, _) = anlegen(&app, &admin, e).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "Port {port}");
    }
}

#[tokio::test]
async fn zweite_smtp_anbindung_ist_422() {
    let (app, admin, _) = setup().await;
    let (s, a) = anlegen(&app, &admin, einstellungen()).await;
    assert_eq!(s, StatusCode::CREATED, "{a}");
    let (s, _) = anlegen(&app, &admin, einstellungen()).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);

    // Auch eine angehaltene Anbindung zählt.
    let id = a["id"].as_str().unwrap();
    let (s, _) = anfrage_json(&app, "POST", &format!("{LISTE}/{id}/pause"), &admin, None).await;
    assert!(s.is_success(), "{s}");
    let (s, _) = anlegen(&app, &admin, einstellungen()).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn probe_meldet_anmeldefehler_als_abgelehnt() {
    let (app, admin, pruefer) = setup().await;
    let (_, a) = anlegen(&app, &admin, einstellungen()).await;
    let id = a["id"].as_str().unwrap();
    let pfad = format!("{LISTE}/{id}/check");

    let (_, e) = anfrage_json(&app, "POST", &pfad, &admin, None).await;
    assert_eq!(e["erfolg"], true, "{e}");
    assert_eq!(e["anzahl"], 0);

    pruefer
        .skript
        .lock()
        .unwrap()
        .push_back(Err(SmtpFehler::Anmeldung));
    let (_, e) = anfrage_json(&app, "POST", &pfad, &admin, None).await;
    assert_eq!(e["erfolg"], false);
    assert_eq!(e["fehler_art"], "abgelehnt");

    pruefer
        .skript
        .lock()
        .unwrap()
        .push_back(Err(SmtpFehler::Abgelehnt(554)));
    let (_, e) = anfrage_json(&app, "POST", &pfad, &admin, None).await;
    assert_eq!(e["fehler_art"], "status");
    assert_eq!(e["status"], 554);
}
