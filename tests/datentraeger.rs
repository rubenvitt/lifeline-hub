//! LFH-1100: `GET /api/system/datentraeger` — Rechte, Stand vor der ersten Prüfung und die
//! Warnregel samt Zusicherung externer Verschlüsselung, über HTTP.

mod common;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use lifeline_hub::datentraeger::{Befund, Ergebnis, Grund, OrtArt, OrtErgebnis, Stand};
use serde_json::Value;
use tower::ServiceExt;

const PFAD: &str = "/api/system/datentraeger";

fn ergebnis(befunde: &[(OrtArt, &str, Befund)]) -> Ergebnis {
    Ergebnis {
        geprueft_um: "2026-10-09 12:00:00".into(),
        orte: befunde
            .iter()
            .map(|(art, pfad, befund)| OrtErgebnis {
                art: *art,
                pfad: pfad.to_string(),
                befund: *befund,
            })
            .collect(),
    }
}

/// Router mit vorgegebenem Stand; liefert ihn mit, damit der Test ein Ergebnis ablegen kann.
async fn setup(extern_zugesichert: bool) -> (axum::Router, Stand, String) {
    let stand = Stand::neu(extern_zugesichert);
    let s = stand.clone();
    let (app, _pool) = common::setup_mit_state(move |state| state.datentraeger = s).await;
    let admin = common::login_cookie(&app, "admin", "startpw12").await;
    (app, stand, admin)
}

async fn status(app: &axum::Router, cookie: &str) -> Value {
    let (code, body) = common::anfrage(app, "GET", PFAD, cookie, None).await;
    assert_eq!(code, StatusCode::OK);
    body
}

#[tokio::test]
async fn nur_der_system_admin_liest_den_stand() {
    let (app, _stand, admin) = setup(false).await;

    let anonym = app
        .clone()
        .oneshot(Request::get(PFAD).body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(anonym.status(), StatusCode::UNAUTHORIZED);

    // Auch eine Führungskraft (darf die Verwaltung) bekommt den Rechnerzustand nicht.
    common::benutzer_anlegen(&app, &admin, "kraft", "fuehrungskraft").await;
    let kraft = common::login_cookie(&app, "kraft", "kraftpw1").await;
    let (code, _) = common::anfrage(&app, "GET", PFAD, &kraft, None).await;
    assert_eq!(code, StatusCode::FORBIDDEN);

    let (code, _) = common::anfrage(&app, "GET", PFAD, &admin, None).await;
    assert_eq!(code, StatusCode::OK);
}

#[tokio::test]
async fn vor_der_ersten_pruefung_keine_warnung() {
    let (app, _stand, admin) = setup(false).await;
    let s = status(&app, &admin).await;
    assert_eq!(s["gesamt"], "unbekannt");
    assert_eq!(s["warnung"], false);
    assert_eq!(s["orte"], serde_json::json!([]));
    assert!(!s.as_object().unwrap().contains_key("geprueft_um"));
}

#[tokio::test]
async fn unverschluesselter_swap_warnt() {
    let (app, stand, admin) = setup(false).await;
    stand.ablegen(ergebnis(&[
        (
            OrtArt::Datenbank,
            "/var/lib/lifeline",
            Befund::Verschluesselt,
        ),
        (OrtArt::Auslagerung, "/dev/sda3", Befund::Unverschluesselt),
    ]));
    let s = status(&app, &admin).await;
    assert_eq!(s["gesamt"], "unverschluesselt");
    assert_eq!(s["warnung"], true);
    assert_eq!(s["geprueft_um"], "2026-10-09 12:00:00");
    assert_eq!(
        s["orte"][1],
        serde_json::json!({"art": "auslagerung", "pfad": "/dev/sda3", "wert": "unverschluesselt"})
    );
}

#[tokio::test]
async fn verschluesselt_warnt_nicht() {
    let (app, stand, admin) = setup(false).await;
    stand.ablegen(ergebnis(&[
        (
            OrtArt::Datenbank,
            "/var/lib/lifeline",
            Befund::Verschluesselt,
        ),
        (OrtArt::Sicherung, "/mnt/usb", Befund::Verschluesselt),
    ]));
    let s = status(&app, &admin).await;
    assert_eq!(s["gesamt"], "verschluesselt");
    assert_eq!(s["warnung"], false);
}

#[tokio::test]
async fn zusicherung_schaltet_unbekannt_ab_aber_nicht_unverschluesselt() {
    let (app, stand, admin) = setup(true).await;
    stand.ablegen(ergebnis(&[(
        OrtArt::Datenbank,
        "/data",
        Befund::Unbekannt(Grund::Virtuell),
    )]));
    let s = status(&app, &admin).await;
    assert_eq!(s["gesamt"], "unbekannt");
    assert_eq!(s["extern_zugesichert"], true);
    assert_eq!(s["warnung"], false);
    assert_eq!(s["orte"][0]["grund"], "virtuell");

    stand.ablegen(ergebnis(&[(
        OrtArt::Datenbank,
        "/data",
        Befund::Unverschluesselt,
    )]));
    assert_eq!(status(&app, &admin).await["warnung"], true);
}

#[tokio::test]
async fn ohne_zusicherung_warnt_unbekannt() {
    let (app, stand, admin) = setup(false).await;
    stand.ablegen(ergebnis(&[(
        OrtArt::Datenbank,
        "/srv/nas",
        Befund::Unbekannt(Grund::Netzlaufwerk),
    )]));
    assert_eq!(status(&app, &admin).await["warnung"], true);
}
